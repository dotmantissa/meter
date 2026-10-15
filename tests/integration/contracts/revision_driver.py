# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Isolated escrow integration harness, never used for an application verdict."""
from genlayer import *
import json


class RevisionDriver(gl.Contract):
    owner: Address
    escrow: Address
    verdicts: TreeMap[str, str]

    def __init__(self):
        self.owner = gl.message.sender_address

    @gl.public.write
    def link(self, escrow: str) -> None:
        if gl.message.sender_address != self.owner or self.escrow != Address('0x'+'0'*40):
            raise gl.vm.UserError('[EXPECTED] Only owner may link once')
        self.escrow = Address(escrow)

    @gl.public.write
    def seed(self, audit_id: str) -> None:
        if gl.message.sender_address != self.owner or audit_id in self.verdicts:
            raise gl.vm.UserError('[EXPECTED] Only owner may seed a fresh fixture')
        self.verdicts[audit_id] = json.dumps({'classification': 'OVERCHARGE', 'difference_cents': 2000,
                                             'revision': 1, 'material_hash': 'a'*64})

    @gl.public.write
    def correct(self, audit_id: str, notify: bool) -> None:
        if gl.message.sender_address != self.owner or audit_id not in self.verdicts:
            raise gl.vm.UserError('[EXPECTED] Only owner may correct an existing fixture')
        self.verdicts[audit_id] = json.dumps({'classification': 'MATCH', 'difference_cents': 0,
                                             'revision': 2, 'material_hash': 'b'*64})
        if notify:
            gl.get_contract_at(self.escrow).emit(on='finalized').refund_changed(audit_id)

    @gl.public.view
    def get_owner(self, audit_id: str) -> Address:
        return self.owner

    @gl.public.view
    def get_verdict(self, audit_id: str) -> dict:
        return json.loads(self.verdicts[audit_id])
