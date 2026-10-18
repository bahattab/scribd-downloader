"""Local adapter for the user-selected themrsami/scribd-downloader repository."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urlparse

ROOT=Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent))

def emit(event,**values):
    print(json.dumps({'event':event,**values},ensure_ascii=True),file=sys.__stdout__,flush=True)

def document_url(value):
    parsed=urlparse(value)
    if parsed.scheme!='https' or parsed.hostname not in {'www.scribd.com','scribd.com'} or parsed.username or parsed.password or parsed.port not in {None,443}:
        raise ValueError('Invalid Scribd URL')
    match=re.fullmatch(r'/(?:document|doc)/(\d+)(?:/[^\r\n]*)?',parsed.path)
    if not match:raise ValueError('Invalid Scribd document path')
    return f'https://www.scribd.com/embeds/{match.group(1)}/content'

def requirements_status():
    missing=[name for name in ('selenium','pypdf') if importlib.util.find_spec(name) is None]
    return {'ready':not missing,'missing':missing}

class ProgressStream:
    def write(self,text):
        if text.strip():emit('progress',detail=text.strip()[:300])
        return len(text)
    def flush(self):pass

def export_document(url,output,max_pages=300):
    driver=None
    profile_handle=None
    try:
        embed=document_url(url)
        if not requirements_status()['ready']:
            emit('result',ok=False,status='setup_required');return 3
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.support.ui import WebDriverWait
        from pypdf import PdfReader
        spec=importlib.util.spec_from_file_location('scribd_upstream',ROOT/'upstream'/'scribd-downloader.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        output=Path(output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
        profile_handle=tempfile.TemporaryDirectory(prefix='eb-scribd-chrome-')
        profile=profile_handle.name
        options=Options();options.add_argument('--headless=new');options.add_argument('--window-size=1600,2200')
        options.add_argument('--user-data-dir='+profile)
        options.add_argument('--disable-dev-shm-usage')
        # Keep Chrome's sandbox and normal automation defaults enabled.
        chrome=os.environ.get('EB_CHROME')
        if chrome:options.binary_location=chrome
        emit('progress',stage='starting_browser')
        from selenium.webdriver.chrome.service import Service
        service=Service(executable_path=os.environ['EB_CHROMEDRIVER']) if os.environ.get('EB_CHROMEDRIVER') else Service()
        driver=webdriver.Chrome(options=options,service=service)
        driver.set_page_load_timeout(45)
        driver.get(embed)
        try:
            WebDriverWait(driver,25).until(lambda browser: browser.find_elements('css selector','.outer_page'))
        except Exception:
            emit('result',ok=False,status='unavailable');return 2
        count=len(driver.find_elements('css selector','.outer_page'))
        if count>max_pages:emit('result',ok=False,status='limit_exceeded');return 2
        # Do not claim to export documents when the visible viewer blocks access.
        if driver.find_elements('css selector','iframe[src*="hcaptcha"],iframe[src*="recaptcha"]'):
            emit('result',ok=False,status='human_required');return 2
        try:title=driver.title
        except Exception:title=''
        emit('progress',stage='rendering',pages=count)
        original=sys.stdout
        try:
            sys.stdout=ProgressStream()
            module.prepare_document_for_print(driver)
            module.inject_print_styles(driver)
            module.save_pdf_pages_individually(driver,str(output))
        finally:sys.stdout=original
        reader=PdfReader(str(output))
        if len(reader.pages)!=count:raise RuntimeError('Exported page count mismatch')
        if output.stat().st_size>20*1024*1024:emit('result',ok=False,status='limit_exceeded');return 2
        emit('result',ok=True,pages=count,bytes=output.stat().st_size,title=title)
        return 0
    except Exception as error:
        print(f'[scribd.worker] {type(error).__name__}: {error}',file=sys.stderr)
        emit('result',ok=False,status='failed');return 1
    finally:
        if driver is not None:
            try:driver.quit()
            except Exception as error:print(f'[browser.cleanup] {error}',file=sys.stderr)
        if profile_handle is not None:
            try:profile_handle.cleanup()
            except Exception as error:print(f'[profile.cleanup] {error}',file=sys.stderr)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser-check',nargs=2,metavar=('CHROME','DRIVER'))
    parser.add_argument('--check',action='store_true');parser.add_argument('--url');parser.add_argument('--output');parser.add_argument('--authorized',action='store_true')
    args=parser.parse_args()
    if args.browser_check:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        import base64
        import io
        from pypdf import PdfReader
        browser=None
        with tempfile.TemporaryDirectory(prefix='fsd-browser-check-') as profile:
            try:
                options=Options();options.binary_location=args.browser_check[0]
                options.add_argument('--headless=new');options.add_argument('--user-data-dir='+profile)
                browser=webdriver.Chrome(options=options,service=Service(args.browser_check[1]))
                browser.get('data:text/html,<title>FSD local check</title><p>Local fixture only</p>')
                pdf=base64.b64decode(browser.execute_cdp_cmd('Page.printToPDF',{})['data'])
                if browser.title!='FSD local check' or len(PdfReader(io.BytesIO(pdf)).pages)!=1:raise RuntimeError('Browser fixture failed')
                emit('browser_check',ok=True)
                return 0
            finally:
                if browser:browser.quit()
    if args.check:
        status=requirements_status();emit('capabilities',**status);return 0 if status['ready'] else 3
    if not args.url or not args.output or not args.authorized:
        emit('result',ok=False,status='invalid_request');return 2
    return export_document(args.url,args.output)

if __name__=='__main__':raise SystemExit(main())
