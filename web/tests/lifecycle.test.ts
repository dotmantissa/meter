import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const mocks=vi.hoisted(()=>({sql:vi.fn(),read:vi.fn(),receipt:vi.fn(),write:vi.fn(),balance:vi.fn(),send:vi.fn()}));
const address=(digit:string):`0x${string}`=>`0x${digit.repeat(40)}`;
const contracts={audit:address('2'),escrow:address('3'),registry:address('1')};
vi.mock('../lib/db',()=>({db:()=>mocks.sql}));
vi.mock('../lib/network',()=>({addresses:()=>contracts,plain:(v:unknown)=>v,
 reader:()=>({readContract:mocks.read,getTransaction:mocks.receipt}),
 userClient:async()=>({account:{address:'0x'+'4'.repeat(40)},writeContract:mocks.write,getBalance:mocks.balance}),
 operator:()=>({account:{address:'0x'+'5'.repeat(40)},writeContract:mocks.write,sendTransaction:mocks.send,getBalance:mocks.balance})}));
import {refreshAudit,executionSucceeded} from '../lib/audits';
import {actOnAudit} from '../lib/actions';
import {reserveOperation,recordBroadcast} from '../lib/operations';
import {ensureBondFunds} from '../lib/sponsor';
import {runWorker} from '../lib/worker';
const pg=new PGlite();const id='a'.repeat(64);
const facts={tariff_id:'pse.7.2026',rate_class:'7',period_start:'2026-09-01',period_end:'2026-09-30',usage_wh:700000,customer_cents:749,energy_cents:12106,bill_hash:'b'.repeat(64),phase:'single',dwelling:'single_family'};
let latest:Record<string,unknown>;let claim:Record<string,unknown>;
beforeAll(async()=>{
 await pg.exec(readFileSync(new URL('../migrations/001_meter.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../migrations/002_review_lifecycle.sql',import.meta.url),'utf8'));
 mocks.sql.mockImplementation(async(strings:TemplateStringsArray,...params:unknown[])=>{const text=strings.reduce((all,s,i)=>all+(i?'$'+i:'')+s,'');return (await pg.query<Record<string,unknown>>(text,params)).rows;});
});
afterAll(()=>pg.close());
beforeEach(async()=>{
 await pg.exec('TRUNCATE meter_operations,meter_audits,meter_tariffs,meter_source_jobs,meter_worker_runs,meter_sponsorships,meter_sponsor_budgets CASCADE');
 latest={id,revision:2,classification:'MATCH',expected_cents:10855,difference_cents:0,material_hash:'c'.repeat(64),facts};claim={status:'OPEN',deposit_wei:1000,material_hash:'d'.repeat(64)};
 mocks.read.mockReset().mockImplementation(async({functionName}:{functionName:string})=>functionName==='get_verdict'?latest:functionName==='get_claim'?claim:functionName==='get_history'?[latest]:functionName==='get_policy'?{bond_wei:1000,monthly_after:0,challenge_after:0}:{changed_without_date:false});
 mocks.receipt.mockReset().mockResolvedValue({statusName:'FINALIZED',consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}]}});
 mocks.write.mockReset().mockResolvedValue('new-operation-tx');mocks.balance.mockReset().mockResolvedValue(BigInt('1000000000000000000'));mocks.send.mockReset().mockResolvedValue('funding-tx');
 await pg.query<Record<string,unknown>>(`INSERT INTO meter_audits(id,user_id,facts,tx_hash,status,verdict,public,audit_address,escrow_address,registry_address,contract_version) VALUES($1,'owner',$2,'original-audit-tx','FINALIZED',$3,true,$4,$5,$6,2)`,[id,JSON.stringify(facts),JSON.stringify({...latest,revision:1}),contracts.audit,contracts.escrow,contracts.registry]);
});
describe('independent verdict and operation lifecycles',()=>{
 it('never finalizes an in-flight cancellation using the original receipt',async()=>{
  const op=await reserveOperation(id,'owner','CANCEL',contracts,2);const record=await refreshAudit(id,'owner');
  expect(record.operation_status).toBe('SUBMITTING');expect(mocks.receipt).not.toHaveBeenCalled();
  expect((await pg.query<Record<string,unknown>>('SELECT current_operation_id FROM meter_audits')).rows[0]).toMatchObject({current_operation_id:op});
  await expect(reserveOperation(id,'owner','APPEAL',contracts,2)).rejects.toThrow('Another action');
 });
 it('uses the canonical leader receipt, regardless of subsequent execution attempts',()=>{
  expect(executionSucceeded({txExecutionResultName:'FINISHED_WITH_RETURN',consensus_data:{leader_receipt:[{execution_result:'ERROR'},{execution_result:'SUCCESS'}]}} as never)).toBe(false);
  expect(executionSucceeded({consensus_data:{leader_receipt:[{execution_result:'SUCCESS'},{execution_result:'ERROR'}]}} as never)).toBe(true);
 });
 it('migrates a legacy snapshot without letting its old revision mask the new history',async()=>{
  await pg.query("UPDATE meter_audits SET contract_version=1,verdict=$1,verdict_checked_at=now(),verdict_synced_at=now()",[JSON.stringify({...latest,revision:7})]);
  const op=await reserveOperation(id,'owner','UPGRADE',contracts,2);await recordBroadcast(op,'new-import-tx');
  const record=await refreshAudit(id,'owner');expect(record.contract_version).toBe(2);expect(record.verdict?.revision).toBe(2);expect(record.operation_status).toBe('FINALIZED');
  expect((await pg.query('SELECT tx_hash,legacy_audit_tx FROM meter_audits')).rows[0]).toEqual({tx_hash:'new-import-tx',legacy_audit_tx:'original-audit-tx'});
 });
 it('serializes simultaneous actions with an atomic row ticket',async()=>{
  const results=await Promise.allSettled(Array.from({length:8},()=>reserveOperation(id,'owner','CANCEL',contracts,2)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await pg.query<Record<string,unknown>>('SELECT * FROM meter_operations')).rows).toHaveLength(1);
 });
 it('installs migration provenance atomically under concurrent receipt refreshes',async()=>{
  await pg.query('UPDATE meter_audits SET contract_version=1,audit_address=$1',[address('8')]);
  const op=await reserveOperation(id,'owner','UPGRADE',contracts,2);await recordBroadcast(op,'migration-tx');
  await Promise.all([refreshAudit(id,'owner'),refreshAudit(id,'owner')]);
  expect((await pg.query('SELECT audit_address,contract_version,current_operation_id FROM meter_audits')).rows[0]).toEqual({audit_address:contracts.audit,contract_version:2,current_operation_id:null});
 });
 it('discards a delayed snapshot from a superseded contract address',async()=>{
  let unblock!:(value:unknown)=>void;let started!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;});
  mocks.read.mockImplementation(({functionName}:{functionName:string})=>functionName==='get_verdict'?new Promise(resolve=>{unblock=resolve;started();}):Promise.resolve(functionName==='get_claim'?claim:[]));
  const refresh=refreshAudit(id,'owner');await waiting;
  await pg.query("UPDATE meter_audits SET audit_address=$1,escrow_address=$2,verdict=$3,claim_snapshot=$4",[address('8'),address('9'),JSON.stringify({...latest,revision:2}),JSON.stringify({status:'NONE'})]);
  unblock({...latest,revision:9});await refresh;
  const row=(await pg.query<Record<string,unknown>>('SELECT verdict,claim_snapshot FROM meter_audits')).rows[0];
  expect(row.verdict).toMatchObject({revision:2});expect(row.claim_snapshot).toEqual({status:'NONE'});
 });
 it('uses the auxiliary receipt and retains cancellation after a failed appeal',async()=>{
  const op=await reserveOperation(id,'owner','APPEAL',contracts,2);await recordBroadcast(op,'failed-action-tx');
  mocks.receipt.mockResolvedValue({statusName:'FINALIZED',consensus_data:{leader_receipt:[{execution_result:'ERROR'}]}});
  const record=await refreshAudit(id,'owner');expect(record.status).toBe('FINALIZED');expect(record.operation_status).toBe('FAILED');
  expect(mocks.receipt).toHaveBeenCalledWith({hash:'failed-action-tx'});
  const result=await actOnAudit('owner',id,'CANCEL');expect(result.operation_status).toBe('PENDING');
  expect(mocks.write).toHaveBeenLastCalledWith(expect.objectContaining({functionName:'cancel',address:contracts.escrow}));
 });
 it('does not treat ACCEPTED execution errors as a finalized auxiliary failure',async()=>{
  const op=await reserveOperation(id,'owner','APPEAL',contracts,2);await recordBroadcast(op,'accepted-tx');
  mocks.receipt.mockResolvedValue({statusName:'ACCEPTED',consensus_data:{leader_receipt:[{execution_result:'ERROR'}]}});
  expect((await refreshAudit(id,'owner')).operation_status).toBe('PENDING');
 });
 it('keeps a broadcast without a hash uncertain instead of reusing an old receipt',async()=>{
  const op=await reserveOperation(id,'owner','CANCEL',contracts,2);await pg.query<Record<string,unknown>>("UPDATE meter_operations SET lease_until=now()-interval '1 hour' WHERE id=$1",[op]);
  expect((await refreshAudit(id,'owner')).operation_status).toBe('UNCERTAIN');expect(mocks.receipt).not.toHaveBeenCalled();
  await recordBroadcast(op,'late-known-tx');expect((await pg.query<Record<string,unknown>>('SELECT status,tx_hash FROM meter_operations')).rows[0]).toMatchObject({status:'PENDING',tx_hash:'late-known-tx'});
 });
 it('refreshes authoritative later revisions for finalized public reports',async()=>{
  const record=await refreshAudit(id);expect(record.verdict?.revision).toBe(2);expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({functionName:'get_verdict'}));expect(record.history).toHaveLength(1);
 });
 it('explicitly labels a cached snapshot when the contract cannot be read',async()=>{
  mocks.read.mockRejectedValue(new Error('RPC unavailable'));const record=await refreshAudit(id,'owner');expect(record.verdict?.revision).toBe(1);expect(record.verdict_check_error).toBe('CONTRACT_READ_UNAVAILABLE');
 });
 it('keeps claim inspection available for a corrected MATCH result',async()=>{
  const record=await refreshAudit(id,'owner');expect(record.verdict?.classification).toBe('MATCH');expect(record.claim?.status).toBe('OPEN');
  await actOnAudit('owner',id,'CANCEL');expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({functionName:'cancel'}));
 });
});
describe('hard sponsorship allowance',()=>{
 it('reserves the last global slot exactly once across distinct users',async()=>{
  await pg.exec('INSERT INTO meter_sponsor_budgets VALUES(CURRENT_DATE,99)');
  const results=await Promise.all(Array.from({length:12},(_,i)=>pg.query<Record<string,unknown>>('SELECT meter_reserve_sponsorship($1) AS reserved',['user'+i])));
  expect(results.filter(r=>r.rows[0].reserved)).toHaveLength(1);
  expect((await pg.query<Record<string,unknown>>('SELECT reserved FROM meter_sponsor_budgets')).rows[0].reserved).toBe(100);
  expect((await pg.query<Record<string,unknown>>('SELECT * FROM meter_sponsorships')).rows).toHaveLength(1);
 });
 it('does not spend a second allowance on duplicate user requests',async()=>{
  const results=await Promise.all(Array.from({length:6},()=>pg.query<Record<string,unknown>>('SELECT meter_reserve_sponsorship($1) AS reserved',['same-user'])));
  expect(results.filter(r=>r.rows[0].reserved)).toHaveLength(1);expect((await pg.query<Record<string,unknown>>('SELECT reserved FROM meter_sponsor_budgets')).rows[0].reserved).toBe(1);
 });
 it('does not broadcast a grant when the global budget is exhausted',async()=>{
  await pg.exec('INSERT INTO meter_sponsor_budgets VALUES(CURRENT_DATE,100)');mocks.balance.mockResolvedValue(BigInt(0));
  const client={account:{address:'0x'+'4'.repeat(40)},getBalance:mocks.balance};
  await expect(ensureBondFunds('owner',client as never,BigInt(1000))).rejects.toThrow('allowance');expect(mocks.send).not.toHaveBeenCalled();
 });
});
describe('shared source refresh terminal recovery',()=>{
 for(const state of ['FINALIZED','CANCELED','UNDETERMINED']) it('replaces a confirmed '+state+' failure after backoff',async()=>{
  await pg.exec("UPDATE meter_audits SET recurring=true,next_check_at=now()-interval '1 day'");
  const key=contracts.registry+':'+facts.tariff_id;
  await pg.query<Record<string,unknown>>("INSERT INTO meter_source_jobs(tariff_id,registry_address,status,tx_hash,attempts) VALUES($1,$2,'PENDING','rejected-refresh',1)",[key,contracts.registry]);
  mocks.receipt.mockResolvedValue({statusName:state,consensus_data:{leader_receipt:[{execution_result:'ERROR'}]}});
  await runWorker();expect((await pg.query<Record<string,unknown>>('SELECT status FROM meter_source_jobs')).rows[0].status).toBe('FAILED');
  await pg.exec("UPDATE meter_source_jobs SET retry_at=now()-interval '1 minute';UPDATE meter_audits SET next_check_at=now()-interval '1 minute'");
  await runWorker();expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({functionName:'refresh'}));
  expect((await pg.query<Record<string,unknown>>('SELECT status,tx_hash,attempts FROM meter_source_jobs')).rows[0]).toMatchObject({status:'PENDING',tx_hash:'new-operation-tx',attempts:2});
 });
 it('does not resubmit an uncertain source broadcast',async()=>{
  await pg.exec("UPDATE meter_audits SET recurring=true,next_check_at=now()-interval '1 day'");
  await pg.query<Record<string,unknown>>("INSERT INTO meter_source_jobs(tariff_id,registry_address,status,attempts) VALUES($1,$2,'UNCERTAIN',1)",[contracts.registry+':'+facts.tariff_id,contracts.registry]);
  await runWorker();await pg.exec("UPDATE meter_audits SET next_check_at=now()-interval '1 minute'");await runWorker();expect(mocks.write).not.toHaveBeenCalled();
 });
});
