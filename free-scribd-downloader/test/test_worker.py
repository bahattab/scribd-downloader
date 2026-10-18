import ast
from pathlib import Path
import re
import unittest
from urllib.parse import urlparse,unquote
import importlib.util

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('worker',ROOT/'scribd_worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class WorkerTests(unittest.TestCase):
    def test_url_contract(self):
        self.assertEqual(worker.document_url('https://www.scribd.com/document/845741935/'),'https://www.scribd.com/embeds/845741935/content')
        for value in ['https://scribd.com.evil.org/document/1/','https://user@www.scribd.com/document/1/','http://www.scribd.com/document/1/','https://www.scribd.com:8443/document/1/','https://www.scribd.com/other/1/']:
            with self.assertRaises(ValueError):worker.document_url(value)
    def test_hardened_upstream_inputs_without_selenium(self):
        tree=ast.parse((ROOT/'upstream'/'scribd-downloader.py').read_text(encoding='utf-8'))
        functions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in {'convert_scribd_link','get_filename_from_url'}]
        namespace={'re':re,'urlparse':urlparse,'unquote':unquote}
        exec(compile(ast.Module(body=functions,type_ignores=[]),'input_functions','exec'),namespace)
        self.assertEqual(namespace['convert_scribd_link']('https://www.scribd.com/doc/1'),'https://www.scribd.com/embeds/1/content')
        self.assertEqual(namespace['convert_scribd_link']('https://evil.org/https://www.scribd.com/doc/1/'),'Invalid Scribd URL')
        for name in ['..%2f..%2fescape','CON','..%5cescape','evil%00name']:
            result=namespace['get_filename_from_url']('https://www.scribd.com/document/1/'+name)
            self.assertNotIn('/',result);self.assertNotIn('\\',result);self.assertNotIn('\x00',result);self.assertNotEqual(result,'CON.pdf')
    def test_no_sandbox_disabling_and_no_first_sheet_truncation(self):
        source=(ROOT/'upstream'/'scribd-downloader.py').read_text(encoding='utf-8')
        self.assertNotIn('--no-sandbox',source)
        self.assertNotIn('"pageRanges": "1"',source)
        self.assertIn('refusing incomplete export',source)

if __name__=='__main__':unittest.main()
