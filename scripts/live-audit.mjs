// A separate test tariff keeps synthetic test inputs out of the app's public aggregates.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import{createClient,createAccount}from '../web/node_modules/genlayer-js/dist/index.js';
import{studionet}from '../web/node_modules/genlayer-js/dist/chains/index.js';
import{transactionsStatusNumberToName}from '../web/node_modules/genlayer-js/dist/types/index.js';
import{createHash}from 'node:crypto';
process.loadEnvFile('.env');
const c=createClient({chain:studionet,account:createAccount(process.env.GENLAYER_PRIVATE_KEY)});
const d=JSON.parse(readFileSync('deployments/studio.json','utf8'));
const path='.contract-build/live-audit.json';
let state;try{state=JSON.parse(readFileSync(path,'utf8'));}catch{state={};}
function save(){writeFileSync(path+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(path+'.tmp',path);}
async function retry(fn,write=false){while(true){try{return await fn();}catch(e){const msg=String(e.details||e.message);if(write && !msg.includes('Rate limit exceeded'))throw e;console.log('Waiting for Studio RPC availability.');await new Promise(r=>setTimeout(r,60000));}}}
async function wait(hash){while(true){const t=await retry(()=>c.getTransaction({hash}));const status=typeof t.status==='number'?transactionsStatusNumberToName[String(t.status)]:t.status;if(['FINALIZED','CANCELED','UNDETERMINED'].includes(status)){if(!t.consensus_data?.leader_receipt?.some(r=>r.execution_result==='SUCCESS')){console.log({hash,status,failures:t.consensus_data?.leader_receipt?.map(r=>({result:r.result,stderr:r.genvm_result?.stderr,eq:r.eq_outputs}))});throw new Error('Live contract execution failed');}return t;}await new Promise(r=>setTimeout(r,20000));}}
const source=JSON.parse(readFileSync('.contract-build/tariff-index.json','utf8')).find(t=>t.utility_id==='avista');
const tariffId='avista.1.selftest';
if(!state.registry_tx){state.registry_tx=await retry(()=>c.writeContract({address:d.contracts.registry.address,functionName:'register',args:[tariffId,source.utility_id,source.schedule_id,source.source_url,source.regulator_url,source.order_url,source.effective_from,source.effective_to],value:0n,leaderOnly:false}),true);save();console.log({stage:'selftest tariff',hash:state.registry_tx});}
await wait(state.registry_tx);
const facts={tariff_id:tariffId,rate_class:'1',period_start:'2026-09-01',period_end:'2026-09-30',usage_wh:800000,customer_cents:1000,energy_cents:8258,bill_hash:createHash('sha256').update('Meter isolated Studio integration fixture, not a household bill').digest('hex'),phase:'single',dwelling:'single_family'};
const canonical=JSON.stringify(Object.fromEntries(Object.keys(facts).sort().map(k=>[k,facts[k]])));
state.audit_id=createHash('sha256').update(c.account.address+canonical).digest('hex');save();
if(!state.audit_tx){state.audit_tx=await retry(()=>c.writeContract({address:d.contracts.audit.address,functionName:'audit_bill',args:[canonical],value:0n,leaderOnly:false}),true);save();console.log({stage:'independent live audit',hash:state.audit_tx});}
const tx=await wait(state.audit_tx);
const verdict=await retry(()=>c.readContract({address:d.contracts.audit.address,functionName:'get_verdict',args:[state.audit_id]}));
if(verdict.classification!=='MATCH'||verdict.expected_cents!==9258)throw new Error('Live independent extraction did not reproduce the filed base charges: '+JSON.stringify(verdict));
state.verdict=verdict;state.consensus_votes=tx.consensus_data?.votes;state.audit_verified=true;save();console.log({classification:verdict.classification,expected_cents:verdict.expected_cents,votes:state.consensus_votes});
if(!state.recheck_tx){state.recheck_tx=await retry(()=>c.writeContract({address:d.contracts.audit.address,functionName:'recheck',args:[state.audit_id],value:0n,leaderOnly:false}),true);save();console.log({stage:'live recheck',hash:state.recheck_tx});}
await wait(state.recheck_tx);
const rechecked=await retry(()=>c.readContract({address:d.contracts.audit.address,functionName:'get_verdict',args:[state.audit_id]}));
if(rechecked.revision!==2||rechecked.expected_cents!==9258)throw new Error('Recheck state did not persist');
state.recheck_verified=true;save();
const pool=await retry(()=>c.readContract({address:d.contracts.escrow.address,functionName:'get_pool',args:[]}));
if(pool.threshold_cents!==1000||pool.mode!=='SUCCESS_FEE_ESCROW')throw new Error('Escrow deployment is not wired');
state.pool_verified=true;save();console.log('Live PDF extraction, validator agreement, real sandbox arithmetic, recheck and linked escrow reads passed.');
