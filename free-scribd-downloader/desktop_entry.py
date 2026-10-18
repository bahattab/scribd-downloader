"""Frozen entry point. --self-test verifies bundled engine without a GUI."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from desktop_client import LocalEngine,APP_ROOT

def self_test(output):
    engine=LocalEngine()
    try:
        client=engine.start()
        demo=client.request('/api/demo','POST',{})
        with tempfile.TemporaryDirectory() as folder:
            saved=client.save(demo['download'],folder,'فحص التشغيل.pdf')
            if not saved.read_bytes().startswith(b'%PDF-'):raise RuntimeError('PDF check failed')
        if getattr(sys,'frozen',False):
            runtime=APP_ROOT/'runtime'
            config=json.loads((runtime/'runtime.json').read_text())
            worker=runtime/config['EB_WORKER_EXE']
            result=subprocess.run([str(worker),'--check'],capture_output=True,text=True,timeout=30)
            if result.returncode!=0:raise RuntimeError('Bundled worker dependencies failed')
            # Local fixture only: prove the bundled Chrome/driver pair launches.
            smoke=subprocess.run([str(worker),'--browser-check',str(runtime/config['EB_CHROME']),str(runtime/config['EB_CHROMEDRIVER'])],capture_output=True,text=True,timeout=60)
            if smoke.returncode!=0:raise RuntimeError('Bundled browser check failed: '+smoke.stderr[-1000:])
        Path(output).write_text(json.dumps({'ok':True,'engine':True,'pdf_write':True,'worker_and_browser':bool(getattr(sys,'frozen',False))}),encoding='utf-8')
    finally:engine.stop()

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--self-test':self_test(sys.argv[2])
    else:
        from desktop import Desktop,tk
        root=tk.Tk();Desktop(root);root.mainloop()
