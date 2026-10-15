"""NIST SP 800-38A vectors and an encrypted PDF through the deployed ZIP reader."""
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfStreamError

ROOT=Path(__file__).resolve().parents[2]
import importlib.util
spec=importlib.util.spec_from_file_location('meter_pdf_aes_provider',ROOT/'scripts/pdf_aes_provider.py')
provider=importlib.util.module_from_spec(spec);spec.loader.exec_module(provider)
CryptAES=provider.CryptAES
aes_cbc_decrypt=provider.aes_cbc_decrypt; aes_cbc_encrypt=provider.aes_cbc_encrypt
aes_ecb_decrypt=provider.aes_ecb_decrypt; aes_ecb_encrypt=provider.aes_ecb_encrypt


@pytest.mark.parametrize('key,ecb,cbc',[
 ('2b7e151628aed2a6abf7158809cf4f3c','3ad77bb40d7a3660a89ecaf32466ef97','7649abac8119b246cee98e9b12e9197d'),
 ('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4','f3eed1bdb5d2a03c064b5a7e3db181f8','f58c4c04d6e5f1ba779eabfb5f7bfbd6'),
])
def test_nist_aes_vectors(key,ecb,cbc):
    key=bytes.fromhex(key);plain=bytes.fromhex('6bc1bee22e409f96e93d7e117393172a')
    iv=bytes.fromhex('000102030405060708090a0b0c0d0e0f')
    assert aes_ecb_encrypt(key,plain)==bytes.fromhex(ecb)
    assert aes_ecb_decrypt(key,bytes.fromhex(ecb))==plain
    assert aes_cbc_encrypt(key,iv,plain)==bytes.fromhex(cbc)
    assert aes_cbc_decrypt(key,iv,bytes.fromhex(cbc))==plain


def test_pdf_padding_is_checked():
    key=b'k'*16;iv=b'i'*16
    good=iv+aes_cbc_encrypt(key,iv,b'public tariff'+b'\x03'*3)
    assert CryptAES(key).decrypt(good)==b'public tariff'
    bad=iv+aes_cbc_encrypt(key,iv,b'public tariff'+b'\x03\x03\x02')
    with pytest.raises(PdfStreamError,match='padding'):CryptAES(key).decrypt(bad)
    with pytest.raises(PdfStreamError,match='blocks'):aes_cbc_decrypt(key,iv,b'broken')


@pytest.mark.parametrize('algorithm',['AES-128','AES-256'])
def test_real_encrypted_pdf_uses_packaged_pure_python_provider(tmp_path,algorithm):
    from test_pdf import document
    writer=PdfWriter(clone_from=PdfReader(io.BytesIO(document(['Filed public rate with all content preserved. '*8]))))
    writer.encrypt('',algorithm=algorithm)
    fixture=tmp_path/'public.pdf'
    with fixture.open('wb') as output:writer.write(output)
    code='''import sys,types,json
from pathlib import Path
module=types.ModuleType('contract');module.__path__=[str(Path('.contract-build/meter_audit.zip').resolve())+'/contract'];sys.modules['contract']=module
from contract.pypdf import PdfReader
from contract.pypdf._crypt_providers import crypt_provider
reader=PdfReader(sys.argv[1],strict=True)
print(json.dumps({'provider':crypt_provider,'text':reader.pages[0].extract_text()}))
'''
    result=subprocess.run([sys.executable,'-c',code,str(fixture)],cwd=ROOT,text=True,capture_output=True,check=True)
    parsed=json.loads(result.stdout)
    assert parsed['provider']==['pyaes','1.6.1']
    assert parsed['text'].count('Filed public rate')==8
