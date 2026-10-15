// Fresh consensus against actual public PDFs. Test tariff IDs never enter the app catalogue.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createClient,createAccount} from '../web/node_modules/genlayer-js/dist/index.js';
import {studionet} from '../web/node_modules/genlayer-js/dist/chains/index.js';
import {transactionsStatusNumberToName,TransactionHashVariant} from '../web/node_modules/genlayer-js/dist/types/index.js';
process.loadEnvFile('.env');
const manifest=JSON.parse(readFileSync('deployments/studio.json','utf8'));
const contracts=Object.fromEntries(Object.entries(manifest.contracts).map(([key,value])=>[key,value.address]));
const client=createClient({chain:studionet,account:createAccount(process.env.GENLAYER_PRIVATE_KEY)});
const run=process.env.METER_PROOF_RUN||'';
if(run&&!/^[a-zA-Z0-9_]{1,32}$/.test(run))throw new Error('Choose a short alphanumeric proof run identifier');
const filename='.contract-build/reviewer-studio-proof'+(run?'-'+run:'')+'.json';
let state;try{state=JSON.parse(readFileSync(filename,'utf8'));}catch{state={contracts,registrations:{},cases:{},policy:{}};}
if(JSON.stringify(state.contracts)!==JSON.stringify(contracts))throw new Error('Proof belongs to a different contract deployment');
function save(){writeFileSync(filename+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(filename+'.tmp',filename);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function retry(fn,write=false){for(;;){try{return await fn();}catch(error){const message=String(error.details||error.message);if(write?!message.includes('Rate limit exceeded'):!/rate limit|fetch|network|socket|ECONNRESET|ETIMEDOUT|timeout|timed out|Unexpected token|Transaction not found|connection|HTTP.*50[234]/i.test(message))throw error;console.log('Studio temporarily unavailable; preserving the same operation.');await sleep(60000);}}}
function status(tx){return tx.statusName||(typeof tx.status==='number'?transactionsStatusNumberToName[String(tx.status)]:tx.status);}
async function receipt(hash,expected=true){for(;;){const tx=await retry(()=>client.getTransaction({hash}));if(['FINALIZED','CANCELED','UNDETERMINED'].includes(status(tx))){const ok=status(tx)==='FINALIZED'&&tx.consensus_data?.leader_receipt?.[0]?.execution_result==='SUCCESS';if(ok!==expected)throw new Error(JSON.stringify({hash,status:status(tx),receipt:tx.consensus_data?.leader_receipt?.[0]?.result}));return tx;}await sleep(25000);}}
const read=(address,functionName,args=[])=>retry(()=>client.readContract({address,functionName,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
async function write(entry,key,address,functionName,args=[],value=0n){if(!entry[key]){entry[key]=await retry(()=>client.writeContract({address,functionName,args,value,leaderOnly:false}),true);save();console.log({functionName,hash:entry[key]});}return entry[key];}
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=facts=>JSON.stringify(Object.fromEntries(Object.keys(facts).sort().map(key=>[key,facts[key]])));
const index=JSON.parse(readFileSync('.contract-build/tariff-index.json','utf8'));
const cases=[
 {name:'pse_boundary',utility:'pse',usage:600000,basic:749,energy:8496,expected:9245},
 {name:'pse_above_boundary',utility:'pse',usage:700000,basic:749,energy:10106,expected:10855},
 {name:'avista_boundary',utility:'avista',usage:800000,basic:1000,energy:8258,expected:9258},
 {name:'avista_second_boundary',utility:'avista',usage:1500000,basic:1000,energy:16747,expected:17747},
 {name:'pacific_single_family',utility:'pacific',usage:700000,basic:850,energy:7436,expected:8286},
 {name:'pacific_multifamily_dispute',utility:'pacific',usage:700000,basic:675,energy:9436,expected:8111,dwelling:'multi_family',difference:2000},
];
for(const source of index){
 const id=source.id+'.review'+(run||'20261015');const entry=state.registrations[source.utility_id]||={id};save();
 await receipt(await write(entry,'tx',contracts.registry,'register',[id,source.utility_id,source.schedule_id,source.source_url,source.regulator_url,source.order_url,source.effective_from,source.effective_to]));
 const tariff=await read(contracts.registry,'require_active',[id,'2026-09-01','2026-09-30']);
 if(tariff.content_hash!==source.content_hash)throw new Error('Fresh source differs from registered catalogue evidence');
 entry.verified=true;entry.content_hash=tariff.content_hash;save();
}
// Submissions are sequential; the network may adjudicate the independent cases concurrently.
for(const test of cases){
 const source=index.find(tariff=>tariff.utility_id===test.utility);
 const facts={tariff_id:state.registrations[test.utility].id,rate_class:source.schedule_id,period_start:'2026-09-01',period_end:'2026-09-30',usage_wh:test.usage,customer_cents:test.basic,energy_cents:test.energy,bill_hash:sha('Meter reviewer integration fixture '+test.name),phase:'single',dwelling:test.dwelling||'single_family'};
 const entry=state.cases[test.name]||={audit_id:sha(client.account.address+canonical(facts)),facts,expected_cents:test.expected,difference_cents:test.difference||0};save();
 await write(entry,'audit_tx',contracts.audit,'audit_bill',[canonical(facts)]);
}
for(const test of cases){
 const entry=state.cases[test.name];const tx=await receipt(entry.audit_tx);const verdict=await read(contracts.audit,'get_verdict',[entry.audit_id]);
 if(verdict.expected_cents!==test.expected||verdict.difference_cents!==(test.difference||0)||verdict.classification!==(test.difference?'OVERCHARGE':'MATCH'))throw new Error('Fresh tariff arithmetic mismatch: '+test.name+' '+JSON.stringify(verdict));
 entry.verdict=verdict;entry.votes=tx.consensus_data?.votes;entry.verified=true;save();console.log({case:test.name,expected_cents:verdict.expected_cents,classification:verdict.classification});
}
const disputed=state.cases.pacific_multifamily_dispute;
const fee=1000000000000000n;
await receipt(await write(state.policy,'open_tx',contracts.escrow,'open_claim',[disputed.audit_id],fee));
const original=await read(contracts.escrow,'get_claim',[disputed.audit_id]);
await receipt(await write(state.policy,'early_monthly_tx',contracts.audit,'recheck',[disputed.audit_id]),false);
const policy=await read(contracts.audit,'get_policy',[disputed.audit_id,client.account.address]);
await receipt(await write(state.policy,'appeal_tx',contracts.audit,'appeal',[disputed.audit_id],BigInt(policy.bond_wei)));
const confirmed=await read(contracts.audit,'get_verdict',[disputed.audit_id]);
if(confirmed.revision!==2||confirmed.material_hash!==original.material_hash)throw new Error('Unchanged challenge altered material identity');
state.policy.confirmation_verified=true;save();
await receipt(await write(state.policy,'resolve_tx',contracts.escrow,'resolve',[disputed.audit_id,1]));
const raw=await retry(()=>client.request({method:'eth_getTransactionByHash',params:[state.policy.resolve_tx]}));
state.policy.payouts=raw.triggered_transactions||[];save();
for(const hash of state.policy.payouts){for(;;){const payout=await retry(()=>client.request({method:'eth_getTransactionByHash',params:[hash]}));if(payout.status==='FINALIZED'||transactionsStatusNumberToName[String(payout.status)]==='FINALIZED'){if(payout.type!==0||payout.value_credited!==true)throw new Error('Native payout failed');break;}await sleep(25000);}}
const settled=await read(contracts.escrow,'get_claim',[disputed.audit_id]);
if(settled.status!=='PARTIAL'||BigInt(settled.fee_wei)!==fee/2000n||BigInt(settled.refund_wei)!==fee-fee/2000n)throw new Error('Proportional settlement failed');
state.policy.claim=settled;state.policy.verified=true;state.completed_at=new Date().toISOString();save();
state.legacy||={};
const oldProof=JSON.parse(readFileSync('deployments/verification.json','utf8'));
const oldId=oldProof.audit.audit_id;
const oldVerdict=await read(manifest.legacy_audit,'get_verdict',[oldId]);
const legacyTariff=oldVerdict.tariff;
if(!state.legacy.tariff_exists&&!state.legacy.register_tx){
 try{const archived=await read(contracts.registry,'get_tariff',[legacyTariff.id]);for(const field of ['content_hash','regulatory_hash','order_hash'])if(archived[field]!==legacyTariff[field])throw new Error('Legacy hash mismatch');state.legacy.tariff_exists=true;save();}
 catch(error){if(!String(error.details||error.message).includes('Unknown tariff'))throw error;}
}
if(!state.legacy.tariff_exists)await receipt(await write(state.legacy,'register_tx',contracts.registry,'register',[legacyTariff.id,legacyTariff.utility_id,legacyTariff.schedule_id,legacyTariff.source_url,legacyTariff.regulator_url,legacyTariff.order_url,legacyTariff.effective_from,legacyTariff.effective_to]));
if(!state.legacy.existing_import&&!state.legacy.import_tx){
 try{const existing=await read(contracts.audit,'get_verdict',[oldId]);if(existing.legacy_origin?.contract.toLowerCase()!==manifest.legacy_audit.toLowerCase())throw new Error('Unexpected existing legacy record');state.legacy.existing_import=true;save();}
 catch(error){if(!String(error.details||error.message).includes('Unknown audit'))throw error;}
}
if(!state.legacy.existing_import)await receipt(await write(state.legacy,'import_tx',contracts.audit,'import_legacy',[oldId]));
const migrated=await read(contracts.audit,'get_verdict',[oldId]);
const history=await read(contracts.audit,'get_history',[oldId,1,20]);
if(migrated.revision!==2||migrated.expected_cents!==9258||history[0].reason!=='LEGACY_SNAPSHOT'||history[1].reason!=='MIGRATION'||migrated.legacy_origin.contract.toLowerCase()!==manifest.legacy_audit.toLowerCase())throw new Error('Legacy evidence migration failed');
state.legacy.audit_id=oldId;state.legacy.verdict=migrated;state.legacy.history=history;state.legacy.verified=true;state.completed_at=new Date().toISOString();save();
console.log('Six fresh full-document consensus cases, early-monthly rejection, unchanged challenge and one-cent proportional settlement verified.');
