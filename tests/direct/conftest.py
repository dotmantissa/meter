import hashlib
import io
import json
import pytest
from pypdf import PdfWriter

@pytest.fixture
def pdf_bytes():
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    buffer = io.BytesIO(); writer.write(buffer)
    return buffer.getvalue()

@pytest.fixture
def params():
    return {'supported': True, 'schedule_id': '7', 'required_class': '7',
        'effective_from': '2026-01-29', 'effective_to': '9999-12-31',
        'basic_micro_usd': 7490000,
        'tiers': [{'up_to_wh':600000,'micro_usd_per_kwh':141598},
                  {'up_to_wh':0,'micro_usd_per_kwh':161015}], 'reason_code':'SUPPORTED'}

@pytest.fixture
def facts():
    return {'tariff_id':'pse.7.2026','rate_class':'7','period_start':'2026-09-01','period_end':'2026-09-30',
        'usage_wh':700000,'customer_cents':749,'energy_cents':10106,
        'bill_hash':'a'*64,'phase':'single','dwelling':'single_family'}

@pytest.fixture
def registry(direct_vm, direct_deploy, pdf_bytes):
    direct_vm.mock_web(r'https://.*', {'status':200, 'body':pdf_bytes})
    r=direct_deploy('contracts/tariff_registry.py')
    r.register('pse.7.2026','pse','7','https://www.pse.com/test.pdf',
        'https://apiproxy.utc.wa.gov/cases/GetDocument?docID=1',
        'https://apiproxy.utc.wa.gov/cases/GetDocument?docID=2','2026-01-29','9999-12-31')
    return r

@pytest.fixture
def audit(direct_vm, direct_deploy, params, monkeypatch):
    from types import SimpleNamespace
    import sys
    t = {'id':'pse.7.2026','schedule_id':'7','effective_from':'2026-01-29', 'source_url':'https://www.pse.com/test.pdf','regulator_url':'https://apiproxy.utc.wa.gov/cases/GetDocument?docID=1', 'order_url':'https://apiproxy.utc.wa.gov/cases/GetDocument?docID=2', 'content_hash':'a'*64,'regulatory_hash':'a'*64,'order_hash':'a'*64}
    a = direct_deploy('contracts/meter_audit.py', '0x'+'1'*40, 100, '0x'+'9'*40)
    module = sys.modules[type(a._instance).__module__]
    def gate(tariff_id, start, end):
        if start < t['effective_from']:
            raise module.gl.vm.UserError('[EXPECTED] Bill crosses or falls outside tariff dates')
        return t
    monkeypatch.setattr(module.gl, 'get_contract_at', lambda address: SimpleNamespace(view=lambda: SimpleNamespace(require_active=gate,require_historical=gate,get_document=lambda digest:b'archived')))
    module._original_source_text = module.source_text
    monkeypatch.setattr(module, 'source_text', lambda url, expected, archived=None: 'Filed schedule 7: rates and effective dates are independently verified in live integration tests.')
    # genlayer-test 0.29.2 returns an empty Sandbox result. Exercise the arithmetic
    # through the VM Return wrapper here; the real sandbox is checked on Studio.
    monkeypatch.setattr(module.gl.vm, 'spawn_sandbox', lambda fn, **kw: module.gl.vm.Return(calldata=fn()))
    direct_vm.mock_llm(r'Extract Meter.*', json.dumps(params))
    return a

@pytest.fixture
def audit_module(audit):
    import sys
    return sys.modules[type(audit._instance).__module__]
