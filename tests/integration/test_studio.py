"""Fresh Studio transactions by default; explicit replay verifies a completed run.

The subprocess runners persist broadcasts before waiting so interrupted work can
be resumed with METER_PROOF_RUN. No model, network, parser or sandbox is mocked.
"""
from pathlib import Path
from datetime import datetime,timezone
import json
import os
import subprocess
import time
import uuid

import pytest
from genlayer_py import create_client
from eth_account import Account
from dotenv import dotenv_values
from genlayer_py.chains import studionet
from genlayer_py.exceptions import GenLayerError
from gltest.assertions import tx_execution_succeeded

ROOT=Path(__file__).resolve().parents[2]

@pytest.fixture(scope='module')
def proof():
    replay=os.environ.get('METER_STUDIO_PROOF_REPLAY')=='1'
    run=os.environ.get('METER_PROOF_RUN','' if replay else datetime.now(timezone.utc).strftime('%Y%m%d%H%M')+uuid.uuid4().hex[:6])
    if not replay:
        environment={**os.environ,'METER_PROOF_RUN':run}
        for script in ('studio-proof.mjs','studio-refunds.mjs'):
            subprocess.run(['node',str(ROOT/'scripts'/script)],cwd=ROOT,env=environment,check=True)
    suffix='-'+run if run else ''
    audit=json.loads((ROOT/('.contract-build/reviewer-studio-proof'+suffix+'.json')).read_text())
    refunds=json.loads((ROOT/('.contract-build/reviewer-refunds'+suffix+'.json')).read_text())
    deployment=json.loads((ROOT/'deployments/studio.json').read_text())
    assert audit['contracts']=={key:value['address'] for key,value in deployment['contracts'].items()}
    assert audit.get('completed_at') and refunds.get('completed_at')
    return audit,refunds,deployment

@pytest.fixture(scope='module')
def chain():
    client=create_client(chain=studionet,account=Account.from_key(dotenv_values(ROOT/'.env')['GENLAYER_PRIVATE_KEY']))
    class ReadClient:
        def __getattr__(self,name):
            fn=getattr(client,name)
            if name not in {'read_contract','get_transaction'}:return fn
            def call(*args,**kwargs):
                for attempt in range(12):
                    try:return fn(*args,**kwargs)
                    except GenLayerError as error:
                        if not any(reason in str(error) for reason in ('Rate limit exceeded','Connection reset by peer','Connection aborted','Read timed out','ConnectTimeout','fetch failed')) or attempt==11:raise
                        print('Studio temporarily unavailable; retrying the same read.',flush=True)
                        time.sleep(30)
            return call
    return ReadClient()

@pytest.mark.parametrize('name',['pse_boundary','pse_above_boundary','avista_boundary','avista_second_boundary','pacific_single_family','pacific_multifamily_dispute'])
def test_fresh_complete_pdf_extraction_and_real_sandbox(chain,proof,name):
    audit,_,_=proof;saved=audit['cases'][name]
    assert saved['verified']
    receipt=chain.get_transaction(saved['audit_tx'])
    assert tx_execution_succeeded(receipt)
    verdict=chain.read_contract(address=audit['contracts']['audit'],function_name='get_verdict',args=[saved['audit_id']])
    assert verdict['expected_cents']==saved['expected_cents']
    assert verdict['difference_cents']==saved['difference_cents']
    assert sum(vote=='agree' for vote in receipt['consensus_data']['votes'].values())>=2
    assert len(verdict['tariff']['content_hash'])==64


def test_monthly_gate_unchanged_challenge_and_proportional_settlement(chain,proof):
    audit,_,_=proof;policy=audit['policy'];saved=audit['cases']['pacific_multifamily_dispute']
    assert policy['verified'] and policy['confirmation_verified']
    assert not tx_execution_succeeded(chain.get_transaction(policy['early_monthly_tx']))
    for key in ('open_tx','appeal_tx','resolve_tx'):assert tx_execution_succeeded(chain.get_transaction(policy[key]))
    claim=chain.read_contract(address=audit['contracts']['escrow'],function_name='get_claim',args=[saved['audit_id']])
    assert claim['status']=='PARTIAL' and claim['recovered_cents']==1
    assert claim['fee_wei']==500000000000 and claim['refund_wei']==999500000000000
    history=chain.read_contract(address=audit['contracts']['audit'],function_name='get_history',args=[saved['audit_id'],1,20])
    assert len(history)==2 and history[0]['material_hash']==history[1]['material_hash']
    assert not history[1]['changed_this_revision']


@pytest.mark.parametrize('name',['automatic_correction','manual_correction','cancel_after_correction'])
def test_corrected_claims_finalize_real_native_refunds(chain,proof,name):
    _,refunds,_=proof;saved=refunds['cases'][name]
    assert saved['verified'] and saved['balance_before']==saved['balance_after']
    claim=chain.read_contract(address=refunds['escrow']['address'],function_name='get_claim',args=[name])
    assert claim['status']==('CANCELLED' if name=='cancel_after_correction' else 'REFUNDED')
    assert claim['deposit_wei']==0 and claim['refund_wei']==1000000000000000
    # Each parent and descendant was awaited, including native value_credited.
    assert saved['payout_tree']['children']


def test_controlled_legacy_import_preserves_original_snapshot(chain,proof):
    audit,_,deployment=proof;saved=audit['legacy']
    assert saved['verified']
    history=chain.read_contract(address=audit['contracts']['audit'],function_name='get_history',args=[saved['audit_id'],1,20])
    assert [revision['reason'] for revision in history]==['LEGACY_SNAPSHOT','MIGRATION']
    assert history[-1]['legacy_origin']['contract'].lower()==deployment['legacy_audit'].lower()
    assert history[-1]['expected_cents']==9258
