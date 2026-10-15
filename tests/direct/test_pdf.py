"""Exercise actual pypdf extraction; only HTTP and model answers are fixtures."""
import hashlib,io
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject


def document(pages):
    writer=PdfWriter()
    for text in pages:
        page=writer.add_blank_page(width=600,height=800)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject();stream.set_data(('BT /F1 10 Tf 20 700 Td ('+text+') Tj ET').encode())
        page[NameObject('/Contents')]=writer._add_object(stream)
    output=io.BytesIO();writer.write(output);return output.getvalue()


def test_actual_parser_inspects_middle_pages(audit_module,direct_vm):
    pages=['Published filed tariff content with applicable monthly rules. '*4]*13
    pages[6]='MIDDLE AUTHORITATIVE RATE 0.17 per kWh with effective date January 1 2026.'
    data=document(pages)
    direct_vm.mock_web(r'https://source.example/.*',{'status':200,'body':data})
    text=audit_module._original_source_text('https://source.example/rates.pdf',hashlib.sha256(data).hexdigest())
    assert 'MIDDLE AUTHORITATIVE RATE 0.17' in text and 'PDF page 13' in text


def test_archive_is_readable_when_url_is_unavailable(audit_module,direct_vm):
    data=document(['Preserved tariff approved monthly rate and applicability. '*5])
    direct_vm.mock_web(r'https://source.example/.*',{'status':404,'body':b''})
    text=audit_module._original_source_text('https://source.example/gone.pdf',hashlib.sha256(data).hexdigest(),data)
    assert 'Preserved tariff' in text
    with direct_vm.expect_revert('changed'):
        audit_module._original_source_text('https://source.example/gone.pdf','a'*64,data)


def test_no_silent_partial_review_of_oversized_text(audit_module,direct_vm):
    data=document(['A'*260000,'B'*260000])
    with direct_vm.expect_revert('Complete document exceeds'):
        audit_module._original_source_text('https://source.example/large.pdf',hashlib.sha256(data).hexdigest(),data)
