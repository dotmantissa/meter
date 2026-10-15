from types import SimpleNamespace
import pytest

@pytest.fixture
def escrow(direct_vm,direct_deploy,direct_owner,monkeypatch):
    import sys
    e=direct_deploy('contracts/recovery_escrow.py','0x'+'1'*40,1000)
    module=sys.modules[type(e._instance).__module__]
    verdict={'classification':'OVERCHARGE','difference_cents':2500,'revision':1,'material_hash':'a'*64}
    transfers=[]
    def proxy(address):
        return SimpleNamespace(view=lambda:SimpleNamespace(get_owner=lambda i:module.Address(direct_owner.as_bytes if hasattr(direct_owner, "as_bytes") else direct_owner),get_verdict=lambda i:verdict),emit_transfer=lambda **kw:transfers.append((address,kw)))
    monkeypatch.setattr(module.gl,'get_contract_at',proxy)
    monkeypatch.setattr(module,'NativeRecipient',lambda address:SimpleNamespace(emit_transfer=lambda **kw:transfers.append((address,kw))))
    return e,verdict,transfers


def test_value_backed_open_and_success(escrow,direct_vm):
    e,v,transfers=escrow
    with direct_vm.expect_revert('deposit'):e.open_claim('bill')
    direct_vm.value=123;e.open_claim('bill')
    assert e.get_pool()['locked_wei']==123
    assert e.get_claim('bill')['disputed_cents']==2500
    with direct_vm.expect_revert('already exists'):e.open_claim('bill')
    direct_vm.value=0;e.resolve('bill',2500)
    assert e.get_claim('bill')['status']=='RECOVERED'
    assert e.get_pool()['locked_wei']==0
    assert transfers[-1][1]=={'value':123}
    with direct_vm.expect_revert('already settled'):e.resolve('bill',2500)


def test_access_control_threshold_and_invalid_recovery(escrow,direct_vm,direct_bob):
    e,v,transfers=escrow
    direct_vm.value=123;direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only audit owner'):e.open_claim('bill')
    with direct_vm.expect_revert('Only recovery operator'):e.resolve('bill',1)


def test_threshold_and_revision_refund(escrow,direct_vm):
    e,v,transfers=escrow
    direct_vm.value=123;v['difference_cents']=999
    with direct_vm.expect_revert('threshold'):e.open_claim('bill')
    v['difference_cents']=1000;e.open_claim('bill')
    with direct_vm.expect_revert('Invalid recovered'):e.resolve('bill',1001)
    with direct_vm.expect_revert('Invalid recovered'):e.resolve('bill',-1)
    v['revision']=2;v['material_hash']='b'*64;e.resolve('bill',1000)
    assert e.get_claim('bill')['status']=='REFUNDED'
    assert e.get_pool()['locked_wei']==0


def test_cancel_returns_deposit_once(escrow,direct_vm,direct_bob):
    e,v,transfers=escrow
    assert e.get_claim('missing')['status']=='NONE'
    direct_vm.value=500;e.open_claim('bill');direct_vm.value=0
    owner=direct_vm.sender;direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Only claim depositor'):e.cancel('bill')
    direct_vm.sender=owner;e.cancel('bill')
    assert e.get_claim('bill')['status']=='CANCELLED'
    assert str(transfers[-1][0])==str(e.beneficiaries['bill'])
    assert e.get_pool()['locked_wei']==0
    with direct_vm.expect_revert('already settled'):e.cancel('bill')


def test_confirmation_does_not_void_success_fee(escrow,direct_vm):
    e,v,transfers=escrow
    direct_vm.value=10000;e.open_claim('bill');direct_vm.value=0
    v['revision']=2;e.resolve('bill',2500)
    assert e.get_claim('bill')['status']=='RECOVERED'
    assert e.get_claim('bill')['fee_wei']==10000


def test_permissionless_correction_refund_is_idempotent(escrow,direct_vm,direct_bob):
    e,v,transfers=escrow
    direct_vm.value=10000;e.open_claim('bill');direct_vm.value=0
    e.refund_changed('bill');assert e.get_claim('bill')['status']=='OPEN'
    v.update({'classification':'MATCH','difference_cents':0,'material_hash':'b'*64})
    direct_vm.sender=direct_bob;e.refund_changed('bill')
    assert e.get_claim('bill')['status']=='REFUNDED'
    assert e.get_pool()['locked_wei']==0
    count=len(transfers);e.refund_changed('bill');e.refund_changed('missing');assert len(transfers)==count


def test_one_cent_and_partial_recovery_release_proportional_fee(escrow,direct_vm):
    e,v,transfers=escrow
    direct_vm.value=10000;e.open_claim('bill');direct_vm.value=0;e.resolve('bill',1)
    c=e.get_claim('bill');assert c['fee_wei']==4 and c['refund_wei']==9996 and c['status']=='PARTIAL'
    assert sum(t[1]['value'] for t in transfers)==10000
