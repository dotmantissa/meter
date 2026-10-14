# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


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
        self.claims[audit_id] = json.dumps({'id': audit_id, 'status': 'OPEN', 'disputed_cents': v['difference_cents'], 'verdict_revision': v['revision'], 'recovered_cents': 0})
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
        # Utility credits occur outside this network. Operator explicitly attests recovery.
        v = gl.get_contract_at(self.audit).view().get_verdict(audit_id)
        if v['revision'] != c['verdict_revision'] or v['difference_cents'] < self.threshold_cents:
            recovered_cents = 0
        deposit = self.deposits[audit_id]
        c['status'] = 'RECOVERED' if recovered_cents > 0 else 'REFUNDED'
        c['recovered_cents'] = recovered_cents
        self.claims[audit_id] = json.dumps(c)
        self.deposits[audit_id] = u256(0)
        self.total_locked = u256(self.total_locked - deposit)
        payee = self.operator if recovered_cents > 0 else self.beneficiaries[audit_id]
        gl.get_contract_at(payee).emit_transfer(value=deposit, on='finalized')

    @gl.public.write
    def cancel(self, audit_id: str) -> None:
        if audit_id not in self.claims or gl.message.sender_address != self.beneficiaries[audit_id]:
            raise gl.vm.UserError('[EXPECTED] Only claim depositor')
        c = json.loads(self.claims[audit_id])
        if c['status'] != 'OPEN':
            raise gl.vm.UserError('[EXPECTED] Claim is already settled')
        deposit = self.deposits[audit_id]
        c['status'] = 'CANCELLED'
        self.claims[audit_id] = json.dumps(c)
        self.deposits[audit_id] = u256(0)
        self.total_locked = u256(self.total_locked-deposit)
        gl.get_contract_at(gl.message.sender_address).emit_transfer(value=deposit, on='finalized')

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
