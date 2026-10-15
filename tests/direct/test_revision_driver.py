"""The separate live escrow harness cannot write application audit state."""
from types import SimpleNamespace
import sys


def test_driver_access_and_finalized_callback(direct_vm,direct_deploy,direct_bob,monkeypatch):
    driver=direct_deploy('tests/integration/contracts/revision_driver.py')
    owner=direct_vm.sender
    driver.seed('isolated')
    assert driver.get_verdict('isolated')['classification']=='OVERCHARGE'
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only owner'):driver.link('0x'+'2'*40)
    with direct_vm.expect_revert('Only owner'):driver.correct('isolated',True)
    direct_vm.sender=owner
    driver.link('0x'+'2'*40)
    with direct_vm.expect_revert('link once'):driver.link('0x'+'3'*40)
    calls=[]
    module=sys.modules[type(driver._instance).__module__]
    def emit(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(refund_changed=lambda audit_id:calls.append(audit_id))
    monkeypatch.setattr(module.gl,'get_contract_at',lambda address:SimpleNamespace(emit=emit))
    driver.correct('isolated',True)
    assert calls==[{'on':'finalized'},'isolated']
    assert driver.get_verdict('isolated')['classification']=='MATCH'
    with direct_vm.expect_revert('fresh fixture'):driver.seed('isolated')
