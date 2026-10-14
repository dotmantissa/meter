import hashlib
import pytest


def test_register_read_and_date_gate(registry, direct_vm, pdf_bytes):
    t=registry.get_tariff('pse.7.2026')
    assert t['content_hash']==hashlib.sha256(pdf_bytes).hexdigest()
    assert len(registry.list_tariffs())==1
    assert registry.require_active('pse.7.2026','2026-09-01','2026-09-30')['revision']==1
    for start,end in [('2025-01-01','2025-01-31'),('2026-01-01','2026-01-31'),('2026-02-30','2026-03-01'),('2026-03-01','2026-02-01')]:
        with direct_vm.expect_revert():registry.require_active('pse.7.2026',start,end)


def test_owner_sources_and_duplicates(registry, direct_vm, direct_bob):
    args=['new','pse','7','https://www.pse.com/test.pdf','https://apiproxy.utc.wa.gov/cases/GetDocument?docID=1','https://apiproxy.utc.wa.gov/cases/GetDocument?docID=2','2026-01-29','9999-12-31']
    with direct_vm.expect_revert('already exists'):registry.register('pse.7.2026',*args[1:])
    invalid=list(args);invalid[3]='https://evil.example/tariff.pdf'
    with direct_vm.expect_revert('approved'):registry.register(*invalid)
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only registry owner'):registry.register(*args)


def test_refresh_preserves_original_and_flags_change(registry, direct_vm):
    original=registry.get_tariff('pse.7.2026')['content_hash']
    registry.refresh('pse.7.2026')
    assert registry.get_tariff('pse.7.2026')['revision']==1
    direct_vm.clear_mocks();direct_vm.mock_web(r'https://.*',{'status':200,'body':b'changed'*100})
    registry.refresh('pse.7.2026')
    t=registry.get_tariff('pse.7.2026')
    assert t['content_hash']==original and t['changed_without_date'] and t['revision']==2
    with direct_vm.expect_revert('changed without'):registry.require_active('pse.7.2026','2026-09-01','2026-09-30')


def test_source_failure_is_not_registered(direct_vm,direct_deploy):
    r=direct_deploy('contracts/tariff_registry.py')
    direct_vm.mock_web(r'https://.*',{'status':503,'body':b''})
    with direct_vm.expect_revert('TRANSIENT'):r.register('new','pse','7','https://www.pse.com/test.pdf','https://apiproxy.utc.wa.gov/cases/GetDocument?docID=1','https://apiproxy.utc.wa.gov/cases/GetDocument?docID=2','2026-01-29','9999-12-31')
    assert r.list_tariffs()==[]
