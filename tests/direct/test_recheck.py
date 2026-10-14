import json

def test_monthly_recheck_keeps_one_aggregate_bill(audit,direct_vm,facts,direct_bob):
    i=audit.audit_bill(json.dumps(facts))
    audit.recheck(i)
    assert audit.get_verdict(i)['revision']==2
    assert audit.get_stats('pse.7.2026','2026-09')['MATCH']==1
    sender=direct_vm.sender;direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only audit owner'):audit.recheck(i)
    direct_vm.sender=sender;direct_vm.value=100;audit.appeal(i)
    assert audit.get_verdict(i)['revision']==3
    assert audit.get_verdict(i)['appealed']
