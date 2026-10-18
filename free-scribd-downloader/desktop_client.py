"""Desktop HTTP and filesystem operations, independent of Tk widgets."""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import signal
import tempfile
import threading
import queue
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request, HTTPRedirectHandler

ROOT=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent))
APP_ROOT=Path(sys.executable).resolve().parent if getattr(sys,'frozen',False) else ROOT
LIMIT=20*1024*1024

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Unexpected redirect from local engine')

def safe_name(name):
    name=re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]',' ',str(name)).strip(' .')
    name=name[:-4] if name.lower().endswith('.pdf') else name
    name=name[:120].strip(' .') or 'Document'
    if re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',name,re.I):name='_'+name
    return name+'.pdf'

class EngineClient:
    def __init__(self,base):
        parsed=urlsplit(base)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or not parsed.port or parsed.path or parsed.username or parsed.password:
            raise ValueError('Engine must be local')
        self.base=base
        self.opener=build_opener(ProxyHandler({}),HTTPCookieProcessor(http.cookiejar.CookieJar()),NoRedirect())
        self.request('/api/health')

    def request(self,path,method='GET',body=None):
        if not path.startswith('/api/') or path.startswith('//') or '\\' in path:raise ValueError('Invalid engine path')
        headers={'Origin':self.base,'Content-Type':'application/json'}
        request=Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
        with self.opener.open(request,timeout=15) as response:
            raw=response.read(1024*1024+1)
            if len(raw)>1024*1024:raise ValueError('Engine response too large')
            return json.loads(raw)

    def save(self,path,folder,filename):
        if not re.fullmatch(r'/api/files/[a-f0-9]{48}',path):raise ValueError('Invalid file path')
        folder=Path(folder).resolve()
        if not folder.is_dir():raise ValueError('Download folder does not exist')
        name=safe_name(filename)
        fd,temporary=tempfile.mkstemp(prefix='.eb-download-',suffix='.part',dir=folder)
        target=None
        try:
            with os.fdopen(fd,'wb') as output, self.opener.open(self.base+path,timeout=30) as response:
                size=0;magic=b''
                while True:
                    chunk=response.read(65536)
                    if not chunk:break
                    if not magic:magic=chunk[:5]
                    size+=len(chunk)
                    if size>LIMIT:raise ValueError('PDF exceeds 20 MB')
                    output.write(chunk)
                if magic!=b'%PDF-':raise ValueError('Invalid PDF response')
            for index in range(10000):
                candidate=folder/(name if index==0 else f'{Path(name).stem} ({index}).pdf')
                try:output=candidate.open('xb')
                except FileExistsError:continue
                target=candidate
                with output,open(temporary,'rb') as source:shutil.copyfileobj(source,output)
                return target
            raise ValueError('Too many filename collisions')
        except BaseException as error:
            if isinstance(error,HTTPError):error.close()
            if target is not None:target.unlink(missing_ok=True)
            raise
        finally:Path(temporary).unlink(missing_ok=True)

class LocalEngine:
    def __init__(self):self.process=None
    def start(self):
        environment=os.environ.copy();environment['PORT']='0'
        flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
        node=str(APP_ROOT/'runtime'/('node.exe' if os.name=='nt' else 'node')) if getattr(sys,'frozen',False) else 'node'
        if getattr(sys,'frozen',False):
            config=json.loads((APP_ROOT/'runtime'/'runtime.json').read_text(encoding='utf-8'))
            for key,relative in config.items():
                path=(APP_ROOT/'runtime'/relative).resolve()
                if not path.is_relative_to((APP_ROOT/'runtime').resolve()) or not path.is_file():raise ValueError('Missing bundled runtime')
                environment[key]=str(path)
        self.log=tempfile.TemporaryFile(mode='w+',encoding='utf-8')
        try:
            self.process=subprocess.Popen([node,str(ROOT/'server.mjs')],cwd=ROOT,env=environment,stdout=subprocess.PIPE,stderr=self.log,text=True,encoding='utf-8',creationflags=flags,start_new_session=os.name!='nt')
            lines=queue.Queue()
            def read():
                for line in self.process.stdout:lines.put(line)
                lines.put(None)
            threading.Thread(target=read,daemon=True).start()
            line=lines.get(timeout=20)
            if line is None or not re.fullmatch(r'EB Docs: http://127\.0\.0\.1:\d+\n?',line):raise RuntimeError('Engine could not start')
            return EngineClient(line.strip().removeprefix('EB Docs: '))
        except BaseException:
            self.stop();raise
    def stop(self):
        if self.process is not None and self.process.poll() is None:
            if os.name=='nt':
                result=subprocess.run(['taskkill','/PID',str(self.process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),timeout=15)
                if result.returncode!=0:self.process.terminate()
            else:os.killpg(self.process.pid,signal.SIGTERM)
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=5)
        if self.process and self.process.stdout:self.process.stdout.close()
        if hasattr(self,'log'):self.log.close()
