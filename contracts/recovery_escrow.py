# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


@gl.evm.contract_interface
class NativeRecipient:
    class View:
        pass
    class Write:
        pass


class RecoveryEscrow(gl.Contract):
    audit: Address
    operator: Address
    threshold_cents: u256
    claims: TreeMap[str, str]
    deposits: TreeMap[str, u256]
    beneficiaries: TreeMap[str, Address]
    total_locked: u256

    def __init__(self, audit: str, threshold_cents: int):
        if threshold_cents <= 0:
            raise gl.vm.UserError('[EXPECTED] Positive threshold required')
        self.audit = Address(audit)
        self.operator = gl.message.sender_address
        self.threshold_cents = u256(threshold_cents)
        self.total_locked = u256(0)

    @gl.public.write.payable
    def open_claim(self, audit_id: str) -> None:
        if audit_id in self.claims:
            raise gl.vm.UserError('[EXPECTED] Claim already exists')
        audited = gl.get_contract_at(self.audit)
        if gl.message.sender_address != audited.view().get_owner(audit_id):
            raise gl.vm.UserError('[EXPECTED] Only audit owner can escrow')
        v = audited.view().get_verdict(audit_id)
        if v['classification'] not in ('OVERCHARGE', 'RATE_CLASS') or v['difference_cents'] < self.threshold_cents:
            raise gl.vm.UserError('[EXPECTED] Verdict is below recovery threshold')
        if gl.message.value <= 0:
            raise gl.vm.UserError('[EXPECTED] Success fee deposit required')
        self.claims[audit_id] = json.dumps({'id': audit_id, 'status': 'OPEN', 'disputed_cents': v['difference_cents'], 'verdict_revision': v['revision'], 'material_hash': v['material_hash'], 'recovered_cents': 0, 'fee_wei': 0, 'refund_wei': 0})
        self.deposits[audit_id] = gl.message.value
        self.beneficiaries[audit_id] = gl.message.sender_address
        self.total_locked = u256(self.total_locked + gl.message.value)

    @gl.public.write
    def resolve(self, audit_id: str, recovered_cents: int) -> None:
        if gl.message.sender_address != self.operator:
            raise gl.vm.UserError('[EXPECTED] Only recovery operator')
        if audit_id not in self.claims:
            raise gl.vm.UserError('[EXPECTED] Unknown claim')
        c = json.loads(self.claims[audit_id])
        if c['status'] != 'OPEN':
            raise gl.vm.UserError('[EXPECTED] Claim is already settled')
        if recovered_cents < 0 or recovered_cents > c['disputed_cents']:
            raise gl.vm.UserError('[EXPECTED] Invalid recovered amount')
        # An operator attests a utility credit; the fee is proportional to recovery.
        v = gl.get_contract_at(self.audit).view().get_verdict(audit_id)
        if v['material_hash'] != c['material_hash'] or v['classification'] not in ('OVERCHARGE', 'RATE_CLASS') or v['difference_cents'] < self.threshold_cents:
            recovered_cents = 0
        deposit = self.deposits[audit_id]
        fee = deposit * recovered_cents // c['disputed_cents']
        refund = deposit - fee
        c['status'] = ('RECOVERED' if recovered_cents == c['disputed_cents'] else 'PARTIAL') if recovered_cents > 0 else 'REFUNDED'
        c['recovered_cents'] = recovered_cents
        c['fee_wei'] = int(fee)
        c['refund_wei'] = int(refund)
        self.claims[audit_id] = json.dumps(c)
        self.deposits[audit_id] = u256(0)
        self.total_locked = u256(self.total_locked - deposit)
        if fee > 0:
            NativeRecipient(self.operator).emit_transfer(value=fee)
        if refund > 0:
            NativeRecipient(self.beneficiaries[audit_id]).emit_transfer(value=refund)

    @gl.public.write
    def refund_changed(self, audit_id: str) -> None:
        # Anyone can finish a correction refund; repeats and unknown claims are safe.
        if audit_id not in self.claims:
            return
        c = json.loads(self.claims[audit_id])
        if c['status'] != 'OPEN':
            return
        v = gl.get_contract_at(self.audit).view().get_verdict(audit_id)
        if v['material_hash'] == c['material_hash']:
            return
        deposit = self.deposits[audit_id]
        c['status'] = 'REFUNDED'
        c['refund_wei'] = int(deposit)
        self.claims[audit_id] = json.dumps(c)
        self.deposits[audit_id] = u256(0)
        self.total_locked = u256(self.total_locked-deposit)
        NativeRecipient(self.beneficiaries[audit_id]).emit_transfer(value=deposit)

    @gl.public.write
    def cancel(self, audit_id: str) -> None:
        if audit_id not in self.claims or gl.message.sender_address != self.beneficiaries[audit_id]:
            raise gl.vm.UserError('[EXPECTED] Only claim depositor')
        c = json.loads(self.claims[audit_id])
        if c['status'] != 'OPEN':
            raise gl.vm.UserError('[EXPECTED] Claim is already settled')
        deposit = self.deposits[audit_id]
        c['status'] = 'CANCELLED'
        c['refund_wei'] = int(deposit)
        self.claims[audit_id] = json.dumps(c)
        self.deposits[audit_id] = u256(0)
        self.total_locked = u256(self.total_locked-deposit)
        NativeRecipient(gl.message.sender_address).emit_transfer(value=deposit)

    @gl.public.view
    def get_claim(self, audit_id: str) -> dict:
        if audit_id not in self.claims:
            return {'status': 'NONE'}
        c = json.loads(self.claims[audit_id])
        c['deposit_wei'] = int(self.deposits[audit_id])
        return c

    @gl.public.view
    def get_pool(self) -> dict:
        return {'threshold_cents': int(self.threshold_cents), 'locked_wei': int(self.total_locked), 'currency': 'Studio GEN', 'mode': 'SUCCESS_FEE_ESCROW'}
