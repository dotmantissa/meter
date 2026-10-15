# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
from datetime import date
import hashlib


@allow_storage
@dataclass
class Tariff:
    utility_id: str
    schedule_id: str
    source_url: str
    regulator_url: str
    order_url: str
    effective_from: str
    effective_to: str
    content_hash: str
    regulatory_hash: str
    order_hash: str
    changed_without_date: bool
    revision: u256


def valid_date(value):
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def fetch_document(url):
    response = gl.nondet.web.get(url)
    if response.status >= 500:
        raise gl.vm.UserError('[TRANSIENT] Source unavailable')
    if response.status != 200:
        raise gl.vm.UserError('[EXTERNAL] Source returned ' + str(response.status))
    if len(response.body) < 100 or len(response.body) > 8000000:
        raise gl.vm.UserError('[EXPECTED] Invalid source size')
    if not response.body.startswith(b'%PDF-'):
        raise gl.vm.UserError('[EXTERNAL] Source is not a PDF')
    return response.body


def fetch_hash(url):
    return hashlib.sha256(fetch_document(url)).hexdigest()


class TariffRegistry(gl.Contract):
    owner: Address
    tariffs: TreeMap[str, Tariff]
    history: TreeMap[str, str]
    keys: DynArray[str]
    documents: TreeMap[str, bytes]

    def __init__(self):
        self.owner = gl.message.sender_address

    @gl.public.write
    def register(self, tariff_id: str, utility_id: str, schedule_id: str,
                 source_url: str, regulator_url: str, order_url: str,
                 effective_from: str, effective_to: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError('[EXPECTED] Only registry owner')
        if tariff_id in self.tariffs:
            raise gl.vm.UserError('[EXPECTED] Tariff already exists')
        if utility_id not in ('pse', 'avista', 'pacific') or not tariff_id or len(tariff_id) > 80:
            raise gl.vm.UserError('[EXPECTED] Unsupported utility or tariff id')
        expected = {'pse': 'https://www.pse.com/', 'avista': 'https://www.myavista.com/',
                    'pacific': 'https://www.pacificpower.net/'}[utility_id]
        if not source_url.startswith(expected) or not regulator_url.startswith('https://apiproxy.utc.wa.gov/cases/GetDocument?') or not order_url.startswith('https://apiproxy.utc.wa.gov/cases/GetDocument?'):
            raise gl.vm.UserError('[EXPECTED] Source must be an approved utility and regulator')
        if not valid_date(effective_from) or not valid_date(effective_to) or effective_from > effective_to:
            raise gl.vm.UserError('[EXPECTED] Invalid effective interval')
        def fetch_registration():
            return [fetch_document(source_url), fetch_document(regulator_url), fetch_document(order_url)]
        bodies = gl.eq_principle.strict_eq(fetch_registration)
        hashes = [hashlib.sha256(body).hexdigest() for body in bodies]
        for digest, body in zip(hashes, bodies):
            self.documents[digest] = body
        self.tariffs[tariff_id] = Tariff(utility_id, schedule_id, source_url, regulator_url,
            order_url, effective_from, effective_to, hashes[0], hashes[1], hashes[2], False, u256(1))
        self.keys.append(tariff_id)
        self.history[tariff_id + ':1'] = hashes[0]

    @gl.public.write
    def refresh(self, tariff_id: str) -> None:
        if tariff_id not in self.tariffs:
            raise gl.vm.UserError('[EXPECTED] Unknown tariff')
        t = self.tariffs[tariff_id]
        def fetch_refresh():
            return [fetch_hash(t.source_url), fetch_hash(t.regulator_url), fetch_hash(t.order_url)]
        hashes = gl.eq_principle.strict_eq(fetch_refresh)
        if hashes != [t.content_hash, t.regulatory_hash, t.order_hash]:
            # Never bless silently replaced evidence. A new dated entry is required.
            t.changed_without_date = True
            t.revision = u256(t.revision + 1)
            self.history[tariff_id + ':' + str(t.revision)] = hashes[0]

    @gl.public.view
    def get_tariff(self, tariff_id: str) -> dict:
        if tariff_id not in self.tariffs:
            raise gl.vm.UserError('[EXPECTED] Unknown tariff')
        t = self.tariffs[tariff_id]
        return {'id': tariff_id, 'utility_id': t.utility_id, 'schedule_id': t.schedule_id,
            'source_url': t.source_url, 'regulator_url': t.regulator_url, 'order_url': t.order_url,
            'effective_from': t.effective_from, 'effective_to': t.effective_to,
            'content_hash': t.content_hash, 'regulatory_hash': t.regulatory_hash,
            'order_hash': t.order_hash, 'changed_without_date': t.changed_without_date,
            'revision': int(t.revision)}

    @gl.public.view
    def require_active(self, tariff_id: str, period_start: str, period_end: str) -> dict:
        t = self.get_tariff(tariff_id)
        if not valid_date(period_start) or not valid_date(period_end) or period_start > period_end:
            raise gl.vm.UserError('[EXPECTED] Invalid bill period')
        if period_start < t['effective_from'] or period_end > t['effective_to']:
            raise gl.vm.UserError('[EXPECTED] Bill crosses or falls outside tariff dates')
        if t['changed_without_date']:
            raise gl.vm.UserError('[EXPECTED] Source changed without a new effective date')
        return t

    @gl.public.view
    def list_tariffs(self) -> list:
        return [self.get_tariff(k) for k in self.keys]

    @gl.public.view
    def get_document(self, digest: str) -> bytes:
        if digest not in self.documents:
            raise gl.vm.UserError('[EXPECTED] Archived evidence not found')
        return self.documents[digest]

    @gl.public.view
    def require_historical(self, tariff_id: str, period_start: str, period_end: str) -> dict:
        t = self.get_tariff(tariff_id)
        if not valid_date(period_start) or not valid_date(period_end) or period_start > period_end or period_start < t['effective_from'] or period_end > t['effective_to']:
            raise gl.vm.UserError('[EXPECTED] Bill crosses or falls outside tariff dates')
        for key in ('content_hash', 'regulatory_hash', 'order_hash'):
            if t[key] not in self.documents:
                raise gl.vm.UserError('[EXPECTED] Historical evidence unavailable')
        return t
