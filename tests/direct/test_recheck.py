import json

def test_monthly_recheck_keeps_one_aggregate_bill(audit,direct_vm,facts,direct_bob):
    i=audit.audit_bill(json.dumps(facts))
    direct_vm.warp('2026-12-01T00:00:00Z')
    audit.recheck(i)
    assert audit.get_verdict(i)['revision']==2
    assert audit.get_stats('pse.7.2026','2026-09')['MATCH']==1
    sender=direct_vm.sender;direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only audit owner'):audit.recheck(i)
    direct_vm.sender=sender;direct_vm.value=100;audit.appeal(i)
    assert audit.get_verdict(i)['revision']==3
    assert audit.get_verdict(i)['appealed']


def test_monthly_policy_and_third_party_cannot_exhaust_owner_challenges(audit,direct_vm,facts,direct_bob):
    i=audit.audit_bill(json.dumps(facts))
    with direct_vm.expect_revert('not due'):audit.recheck(i)
    owner=direct_vm.sender;direct_vm.sender=direct_bob;direct_vm.value=100;audit.appeal(i)
    direct_vm.sender=owner;audit.appeal(i)
    assert audit.get_verdict(i)['revision']==3
    with direct_vm.expect_revert('one hour'):audit.appeal(i)
    direct_vm.warp('2026-12-01T00:00:00Z');direct_vm.value=0;audit.recheck(i)
    assert audit.get_verdict(i)['revision']==4
    with direct_vm.expect_revert('not due'):audit.recheck(i)


def test_unchanged_confirmation_keeps_correction_and_full_history(audit,audit_module,direct_vm,facts,params,monkeypatch):
    from types import SimpleNamespace
    i=audit.audit_bill(json.dumps(facts));first=audit.get_verdict(i)
    direct_vm.clear_mocks();direct_vm.mock_llm(r'Extract Meter.*',json.dumps({**params,'basic_micro_usd':7990000}))
    monkeypatch.setattr(audit_module,'NativeRecipient',lambda address:SimpleNamespace(emit_transfer=lambda **kw:None))
    direct_vm.value=100;audit.appeal(i);corrected=audit.get_verdict(i)
    direct_vm.warp('2026-12-01T00:00:00Z');direct_vm.value=0;audit.recheck(i);last=audit.get_verdict(i)
    assert last['corrected'] and not last['changed_this_revision']
    assert last['material_hash']==corrected['material_hash']!=first['material_hash']
    assert last['material_revision']==2
    history=audit.get_history(i,1,20)
    assert [v['revision'] for v in history]==[1,2,3]
    assert history[0]['classification']=='MATCH' and history[1]['classification']=='UNDERCHARGE'
    assert audit.get_history(i,2,1)[0]['material_hash']==corrected['material_hash']


def test_legacy_import_requires_owner_and_committed_evidence(audit,audit_module,direct_vm,facts,params,monkeypatch,direct_bob):
    from types import SimpleNamespace
    module=audit_module;owner=module.gl.message.sender_address
    original_proxy=module.gl.get_contract_at
    t=original_proxy(audit.registry).view().require_historical(facts['tariff_id'],facts['period_start'],facts['period_end'])
    old={**module.recompute(facts,params),'id':'c'*64,'facts':facts,'tariff':dict(t),'parameters':params,'scope':'BASE_CHARGES','revision':7}
    def proxy(address):
        if str(address)==str(audit.legacy_audit):return SimpleNamespace(view=lambda:SimpleNamespace(get_owner=lambda i:owner,get_verdict=lambda i:old))
        return original_proxy(address)
    monkeypatch.setattr(module.gl,'get_contract_at',proxy)
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only legacy audit owner'):audit.import_legacy('c'*64)
    direct_vm.sender=owner
    old['tariff']['content_hash']='b'*64
    with direct_vm.expect_revert('does not match'):audit.import_legacy('c'*64)
    old['tariff']=dict(t);audit.import_legacy('c'*64)
    assert audit.get_verdict('c'*64)['legacy_origin']['revision']==7
    assert [v['reason'] for v in audit.get_history('c'*64)]==['LEGACY_SNAPSHOT','MIGRATION']


def test_material_correction_queues_escrow_sync_after_finalization(audit,audit_module,direct_vm,facts,params,monkeypatch):
    from types import SimpleNamespace
    module=audit_module;calls=[];original=module.gl.get_contract_at
    audit.set_escrow('0x'+'2'*40)
    def proxy(address):
        if str(address)==str(audit.escrow):return SimpleNamespace(emit=lambda **kw:SimpleNamespace(refund_changed=lambda i:calls.append((kw,i))))
        return original(address)
    monkeypatch.setattr(module.gl,'get_contract_at',proxy)
    monkeypatch.setattr(module,'NativeRecipient',lambda address:SimpleNamespace(emit_transfer=lambda **kw:None))
    i=audit.audit_bill(json.dumps(facts));direct_vm.clear_mocks();direct_vm.mock_llm(r'Extract Meter.*',json.dumps({**params,'basic_micro_usd':7990000}))
    direct_vm.value=100;audit.appeal(i)
    assert calls==[({'on':'finalized'},i)]
    direct_vm.warp('2026-12-01T00:00:00Z');direct_vm.value=0;audit.recheck(i)
    assert len(calls)==1
