"""Build on the target OS; bundles Python, Node, Selenium, pypdf and CfT."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parent
VERSION=json.loads((ROOT/'package.json').read_text())['version']

def run(args):subprocess.run([str(x) for x in args],cwd=ROOT,check=True)

def download(url,target):
    if not url.startswith(('https://googlechromelabs.github.io/','https://storage.googleapis.com/chrome-for-testing-public/')):raise ValueError('Unexpected browser distribution URL')
    with urlopen(url,timeout=120) as response,open(target,'wb') as output:shutil.copyfileobj(response,output)

def extract(archive,folder):
    folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(archive) as source:
        for item in source.infolist():
            if not (folder/item.filename).resolve().is_relative_to(folder.resolve()):raise ValueError('Invalid archive path')
        if sys.platform=='darwin':run(['ditto','-x','-k',archive,folder]);return
        source.extractall(folder)
        if os.name!='nt':
            for item in source.infolist():
                mode=item.external_attr>>16
                if mode:(folder/item.filename).chmod(mode & 0o777)

def main():
    os.chdir(ROOT)
    target={'win32':'win64','linux':'linux64','darwin':'mac-arm64' if platform.machine()=='arm64' else 'mac-x64'}[sys.platform]
    if platform.machine().lower() not in {'amd64','x86_64','arm64','aarch64'}:raise RuntimeError('Unsupported architecture')
    if sys.platform!='darwin' and platform.machine().lower() in {'arm64','aarch64'}:raise RuntimeError('This build recipe targets x64 on Windows/Linux')
    extension='.exe' if os.name=='nt' else ''
    common=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir']
    # No workstation folders, credentials, profiles, environment or logs become data files.
    data=[]
    for name in ['server.mjs','jobs.mjs','files.mjs','filenames.mjs','downloader.mjs','scribd.mjs','public']:
        data.extend(['--add-data',f'{ROOT/name}{os.pathsep}.']) if name!='public' else data.extend(['--add-data',f'{ROOT/name}{os.pathsep}public'])
    run(common+['--name','FreeScribdDownloader']+(['--windowed'] if os.name=='nt' else [])+data+['desktop_entry.py'])
    run(common+['--name','FSDWorker','--collect-all','selenium','--collect-all','pypdf','--add-data',f'{ROOT/"upstream"}{os.pathsep}upstream','scribd_worker.py'])
    app=ROOT/'dist'/'FreeScribdDownloader';runtime=app/'runtime';runtime.mkdir(exist_ok=True)
    shutil.copytree(ROOT/'dist'/'FSDWorker',runtime/'worker',dirs_exist_ok=True)
    node=shutil.which('node')
    if not node:raise RuntimeError('Node.js 24 is required on the build host')
    node_version=subprocess.check_output([node,'--version'],text=True).strip()
    if int(node_version.lstrip('v').split('.')[0])<24:raise RuntimeError('Node.js 24+ required')
    shutil.copy2(node,runtime/('node'+extension))
    license_candidates=[Path(node).parent/'LICENSE',Path(node).parent.parent/'LICENSE',Path(node).parent.parent/'share'/'doc'/'node'/'LICENSE']
    for candidate in license_candidates:
        if candidate.is_file():shutil.copy2(candidate,runtime/'NODE-LICENSE.txt');break
    else:raise RuntimeError('Node distribution LICENSE missing; refusing incomplete bundle')
    with tempfile.TemporaryDirectory(prefix='fsd-build-') as temp:
        temp=Path(temp);metadata=temp/'versions.json'
        download('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json',metadata)
        stable=json.loads(metadata.read_text())['channels']['Stable'];browser=runtime/'browser'
        for artifact in ['chrome','chromedriver']:
            url=next(item['url'] for item in stable['downloads'][artifact] if item['platform']==target)
            archive=temp/(artifact+'.zip');download(url,archive);extract(archive,browser)
    chrome=f'browser/chrome-{target}/'+('Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' if sys.platform=='darwin' else 'chrome'+extension)
    config={'EB_WORKER_EXE':'worker/FSDWorker'+extension,'EB_CHROME':chrome,'EB_CHROMEDRIVER':f'browser/chromedriver-{target}/chromedriver'+extension}
    (runtime/'runtime.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    for filename in ['README.md','THIRD-PARTY-NOTICES.md','PRIVACY.md','CHANGELOG.md']:shutil.copy2(ROOT/filename,app/filename)
    # Metadata contains versions only; no host environment or personal paths.
    (app/'BUNDLE-VERSIONS.json').write_text(json.dumps({'app':VERSION,'node':node_version,'chrome':stable['version'],'os':sys.platform,'arch':platform.machine()},indent=2))
    report=ROOT/'dist'/'bundle-self-test.json'
    run([app/('FreeScribdDownloader'+extension),'--self-test',report])
    if not json.loads(report.read_text())['ok']:raise RuntimeError('Bundle smoke test failed')
    release=ROOT/'release';release.mkdir(exist_ok=True)
    label={'win32':'Windows-x64','linux':'Linux-x64','darwin':'macOS-'+platform.machine()}[sys.platform]
    name=release/f'Free-Scribd-Downloader-{VERSION}-{label}'
    shutil.make_archive(str(name),'zip' if os.name=='nt' else 'gztar',root_dir=app.parent,base_dir=app.name)
    if os.name=='nt':
        compiler=shutil.which('iscc') or str(Path(os.environ.get('ProgramFiles(x86)','C:/Program Files (x86)'))/'Inno Setup 6'/'ISCC.exe')
        run([compiler,'/DAppVersion='+VERSION,ROOT/'build'/'installer.iss'])
    for artifact in release.iterdir():
        if artifact.suffix!='.sha256':artifact.with_name(artifact.name+'.sha256').write_text(hashlib.sha256(artifact.read_bytes()).hexdigest()+'  '+artifact.name+'\n')

if __name__=='__main__':main()
