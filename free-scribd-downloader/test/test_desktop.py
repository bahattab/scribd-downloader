import importlib.util
import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from desktop_client import EngineClient,LocalEngine,safe_name

class DesktopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script="""import {createApp,samplePDF} from './server.mjs';
const app=createApp({resolver:async url=>url.includes('missing')?{available:false}:{body:samplePDF(),title:'استبيان قياس الطلاق العاطفي'}});
app.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+app.address().port));"""
        cls.process=subprocess.Popen(['node','--input-type=module','-e',script],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        lines=queue.Queue()
        threading.Thread(target=lambda:lines.put(cls.process.stdout.readline()),daemon=True).start()
        cls.base=lines.get(timeout=15).strip()

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate();cls.process.wait(timeout=10);cls.process.stdout.close()

    def test_original_arabic_title_sequential_batch_and_collision(self):
        client=EngineClient(self.base)
        batch=client.request('/api/batches','POST',{'urls':['https://example.org/one.pdf','https://example.org/missing.pdf','https://example.org/two.pdf'],'authorized':True})
        for _ in range(100):
            view=client.request('/api/batches/'+batch['id'])
            if not view['active']:break
            time.sleep(.02)
        self.assertEqual([x['status'] for x in view['items']],['ready','unavailable','ready'])
        with tempfile.TemporaryDirectory() as folder:
            paths=[client.save(item['download'],folder,item['filename']) for item in view['items'] if item['status']=='ready']
            self.assertEqual(paths[0].name,'استبيان قياس الطلاق العاطفي.pdf')
            self.assertEqual(paths[1].name,'استبيان قياس الطلاق العاطفي (1).pdf')
            for path in paths:self.assertTrue(path.read_bytes().startswith(b'%PDF-'))
            self.assertEqual(len(list(Path(folder).iterdir())),2)

    def test_wrong_session_cannot_save_and_leaves_no_partial(self):
        first=EngineClient(self.base);other=EngineClient(self.base)
        demo=first.request('/api/demo','POST',{})
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(Exception):other.save(demo['download'],folder,'secret.pdf')
            self.assertEqual(list(Path(folder).iterdir()),[])

    def test_local_engine_owns_dynamic_port_and_stops(self):
        engine=LocalEngine()
        try:
            client=engine.start();self.assertEqual(client.request('/api/health')['status'],'ok')
            self.assertIsNone(engine.process.poll())
        finally:engine.stop()
        self.assertIsNotNone(engine.process.poll())

    def test_paths_and_names(self):
        for url in ['https://example.org','http://localhost:123','http://127.0.0.1:123/path']:
            with self.assertRaises(ValueError):EngineClient(url)
        client=EngineClient(self.base)
        with self.assertRaises(ValueError):client.save('https://example.org/file.pdf','.','file.pdf')
        self.assertNotIn('/',safe_name('../../test.pdf'))
        self.assertEqual(safe_name('CON.pdf'),'_CON.pdf')

if __name__=='__main__':unittest.main()
