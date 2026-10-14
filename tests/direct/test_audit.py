import copy
import json
import pytest


def test_tiers_exact_boundary_and_rounding(audit_module, params, facts):
    for wh, expected in [(0,749),(600000,9245),(700000,10855),(600001,9245),(1500000,23736)]:
        f={**facts,'usage_wh':wh}
        assert audit_module.recompute(f,params)['expected_cents']==expected


def test_write_read_duplicate_and_counts(audit,direct_vm,facts):
    audit_id=audit.audit_bill(json.dumps(facts))
    v=audit.get_verdict(audit_id)
    assert v['classification']=='MATCH' and v['scope']=='BASE_CHARGES'
    assert v['expected_cents']==10855
    assert audit.get_stats('pse.7.2026','2026-09')['MATCH']==1
    with direct_vm.expect_revert('already'):audit.audit_bill(json.dumps(facts))
    assert direct_vm.run_validator()


@pytest.mark.parametrize('change',[
    {'account_number':'secret'}, {'usage_wh':-1}, {'usage_wh':True}, {'bill_hash':'bad'},
    {'phase':'unknown'}, {'period_end':'2026-09-10'}, {'rate_class':'my private address'}, {'energy_cents':1000000001}])
def test_anonymous_schema_and_boundaries(audit,direct_vm,facts,change):
    with direct_vm.expect_revert():audit.audit_bill(json.dumps({**facts,**change}))


def test_overcharge_rate_class_and_lapsed(audit,direct_vm,facts):
    a=audit.audit_bill(json.dumps({**facts,'energy_cents':11006}))
    assert audit.get_verdict(a)['difference_cents']==900
    assert audit.get_verdict(a)['classification']=='OVERCHARGE'
    b=audit.audit_bill(json.dumps({**facts,'rate_class':'8'}))
    assert audit.get_verdict(b)['classification']=='RATE_CLASS'
    with direct_vm.expect_revert('outside'):audit.audit_bill(json.dumps({**facts,'period_start':'2026-01-01','period_end':'2026-01-31'}))


def test_independent_validator_rejects_different_rates(audit,direct_vm,facts,params):
    audit.audit_bill(json.dumps(facts))
    changed=copy.deepcopy(params);changed['tiers'][0]['micro_usd_per_kwh']+=1
    direct_vm.clear_mocks();direct_vm.mock_llm(r'Extract Meter.*',json.dumps(changed))
    assert not direct_vm.run_validator()


def test_half_percent_and_class_exact(audit_module,params):
    base={'parameters':params,'classification':'MATCH','expected_cents':10000,'energy_cents':10000,'customer_cents':0}
    assert audit_module.equivalent({**base,'expected_cents':10050},base)
    assert not audit_module.equivalent({**base,'expected_cents':10051},base)
    assert not audit_module.equivalent({**base,'classification':'OVERCHARGE'},base)


def test_inconclusive_and_malformed_extraction(audit,direct_vm,facts,params):
    direct_vm.clear_mocks();direct_vm.mock_llm(r'Extract Meter.*',json.dumps({**params,'supported':False,'reason_code':'MISSING_RULE'}))
    i=audit.audit_bill(json.dumps(facts))
    assert audit.get_verdict(i)['classification']=='INSUFFICIENT_EVIDENCE'
    assert audit.get_verdict(i)['difference_cents']==0
    direct_vm.clear_mocks();direct_vm.mock_llm(r'Extract Meter.*','{"supported":true}')
    with direct_vm.expect_revert('LLM_ERROR'):audit.audit_bill(json.dumps({**facts,'bill_hash':'b'*64}))


@pytest.mark.parametrize('tiers',[
    [{'up_to_wh':5,'micro_usd_per_kwh':1}],
    [{'up_to_wh':0,'micro_usd_per_kwh':1},{'up_to_wh':0,'micro_usd_per_kwh':1}],
    [{'up_to_wh':10,'micro_usd_per_kwh':1},{'up_to_wh':9,'micro_usd_per_kwh':1},{'up_to_wh':0,'micro_usd_per_kwh':1}],
    [{'up_to_wh':0,'micro_usd_per_kwh':-1}],
    [{'up_to_wh':0,'micro_usd_per_kwh':1.5}]
])
def test_reject_invalid_tiers(audit_module,direct_vm,params,tiers):
    with direct_vm.expect_revert('LLM_ERROR'):audit_module.normalize_parameters({**params,'tiers':tiers})


def test_bond_appeal_once_and_corrections(audit,direct_vm,facts,params):
    i=audit.audit_bill(json.dumps(facts))
    with direct_vm.expect_revert('Exact appeal bond'):audit.appeal(i)
    direct_vm.value=100
    audit.appeal(i)
    assert audit.get_verdict(i)['revision']==2
    assert not audit.get_verdict(i)['corrected']
    assert audit.get_stats('pse.7.2026','2026-09')['MATCH']==1
    with direct_vm.expect_revert('already'):audit.appeal(i)


def test_error_comparison_never_agrees_on_bad_model(audit_module):
    gl=audit_module.gl
    def fail(message):
        def run():raise gl.vm.UserError(message)
        return run
    assert audit_module.compare_error(gl.vm.UserError('[TRANSIENT] timeout'),fail('[TRANSIENT] network'))
    assert audit_module.compare_error(gl.vm.UserError('[EXPECTED] dates'),fail('[EXPECTED] dates'))
    assert not audit_module.compare_error(gl.vm.UserError('[LLM_ERROR] bad'),fail('[LLM_ERROR] bad'))
    assert not audit_module.compare_error(gl.vm.UserError('[EXPECTED] dates'),lambda: {})
