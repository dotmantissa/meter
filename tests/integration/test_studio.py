"""Read back real Studio receipts and state after the resumable live test scripts."""
from pathlib import Path
import json
import pytest
import time
from genlayer_py import create_client
from eth_account import Account
from dotenv import dotenv_values
from genlayer_py.chains import studionet
from genlayer_py.exceptions import GenLayerError
from gltest.assertions import tx_execution_succeeded

ROOT=Path(__file__).resolve().parents[2]

@pytest.fixture(scope='module')
def chain():
    client=create_client(chain=studionet,account=Account.from_key(dotenv_values(ROOT/'.env')['GENLAYER_PRIVATE_KEY']))
    class ReadClient:
        def __getattr__(self,name):
            fn=getattr(client,name)
            if name not in {'read_contract', 'get_transaction'}:
                return fn
            def call(*args,**kwargs):
                for attempt in range(10):
                    try:return fn(*args,**kwargs)
                    except GenLayerError as e:
                        temporary = any(reason in str(e) for reason in (
                            'Rate limit exceeded', 'Connection reset by peer',
                            'Connection aborted', 'Read timed out', 'ConnectTimeout',
                        ))
                        if not temporary or attempt==9:raise
                        print('Studio read temporarily unavailable; retrying the same read.',flush=True)
                        time.sleep(30)
            return call
    return ReadClient()

@pytest.fixture(scope='module')
def deployment():
    return json.loads((ROOT/'deployments/studio.json').read_text())

def test_registry_sources_exist_and_are_date_gated(chain,deployment):
    address=deployment['contracts']['registry']['address']
    tariff=chain.read_contract(address=address,function_name='require_active',args=['avista.1.2026','2026-09-01','2026-09-30'])
    assert tariff['schedule_id']=='1'
    assert len(tariff['content_hash'])==64
    assert tariff['regulator_url'].startswith('https://apiproxy.utc.wa.gov/')
    assert not tariff['changed_without_date']

def test_live_independent_pdf_extraction_and_sandbox(chain,deployment):
    saved=json.loads((ROOT/'.contract-build/live-audit.json').read_text())
    assert saved['audit_verified'] and saved['recheck_verified']
    receipt=chain.get_transaction(saved['audit_tx'])
    succeeded=tx_execution_succeeded(receipt)
    assert succeeded
    verdict=chain.read_contract(address=deployment['contracts']['audit']['address'],function_name='get_verdict',args=[saved['audit_id']])
    assert verdict['classification']=='MATCH'
    assert verdict['expected_cents']==9258
    assert verdict['parameters']['basic_micro_usd']==10000000
    assert verdict['parameters']['tiers'][0]=={'up_to_wh':800000,'micro_usd_per_kwh':103220}
    assert verdict['revision']==2
    votes=receipt['consensus_data']['votes']
    assert sum(v=='agree' for v in votes.values())>=2

def test_real_native_escrow_and_bonded_appeal(chain,deployment):
    saved=json.loads((ROOT/'.contract-build/live-escrow.json').read_text())
    assert saved['deposit_verified'] and saved['refund_verified'] and saved['appeal_verified']
    succeeded=tx_execution_succeeded(chain.get_transaction(saved['open_tx']))
    assert succeeded
    claim=chain.read_contract(address=deployment['contracts']['escrow']['address'],function_name='get_claim',args=[saved['audit_id']])
    assert claim['status']=='CANCELLED' and claim['deposit_wei']==0
    pool=chain.read_contract(address=deployment['contracts']['escrow']['address'],function_name='get_pool',args=[])
    assert pool['locked_wei']==0 and pool['threshold_cents']==1000
    verdict=chain.read_contract(address=deployment['contracts']['audit']['address'],function_name='get_verdict',args=[saved['audit_id']])
    assert verdict['revision']==2 and verdict['appealed']
