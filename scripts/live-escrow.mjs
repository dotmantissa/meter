import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import{createClient,createAccount}from '../web/node_modules/genlayer-js/dist/index.js';
import{studionet}from '../web/node_modules/genlayer-js/dist/chains/index.js';
import{transactionsStatusNumberToName}from '../web/node_modules/genlayer-js/dist/types/index.js';
import{createHash}from 'node:crypto';
process.loadEnvFile('.env');
const c=createClient({chain:studionet,account:createAccount(process.env.GENLAYER_PRIVATE_KEY)});
const d=JSON.parse(readFileSync('deployments/studio.json','utf8'));
const path='.contract-build/live-escrow.json';let state;try{state=JSON.parse(readFileSync(path,'utf8'));}catch{state={};}
function save(){writeFileSync(path+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(path+'.tmp',path);}
async function retry(fn,write=false){while(true){try{return await fn();}catch(e){if(write&&!String(e.details||e.message).includes('Rate limit exceeded'))throw e;console.log('Waiting for Studio RPC availability.');await new Promise(r=>setTimeout(r,60000));}}}
async function wait(hash){while(true){const t=await retry(()=>c.getTransaction({hash}));const status=typeof t.status==='number'?transactionsStatusNumberToName[String(t.status)]:t.status;if(['FINALIZED','CANCELED','UNDETERMINED'].includes(status)){if(!t.consensus_data?.leader_receipt?.some(r=>r.execution_result==='SUCCESS')){const raw=await retry(()=>c.request({method:'eth_getTransactionByHash',params:[hash]}));if(raw.type===0&&raw.value_credited===true)return t;console.log({hash,status,failures:t.consensus_data?.leader_receipt?.map(r=>({result:r.result,stderr:r.genvm_result?.stderr}))});throw new Error('Live escrow execution failed');}return t;}await new Promise(r=>setTimeout(r,20000));}}
const original=JSON.parse(readFileSync('.contract-build/live-audit.json','utf8')).verdict.facts;
const facts={...original,energy_cents:10258,bill_hash:createHash('sha256').update('Meter isolated recovery test fixture, not a household bill').digest('hex')};
const canonical=JSON.stringify(Object.fromEntries(Object.keys(facts).sort().map(k=>[k,facts[k]])));
state.audit_id=createHash('sha256').update(c.account.address+canonical).digest('hex');save();
if(!state.audit_tx){state.audit_tx=await retry(()=>c.writeContract({address:d.contracts.audit.address,functionName:'audit_bill',args:[canonical],value:0n,leaderOnly:false}),true);save();console.log({stage:'isolated recovery verdict',hash:state.audit_tx});}
await wait(state.audit_tx);
const verdict=await retry(()=>c.readContract({address:d.contracts.audit.address,functionName:'get_verdict',args:[state.audit_id]}));
if(verdict.classification!=='OVERCHARGE'||verdict.difference_cents!==2000)throw new Error('Expected isolated disputed amount');
if(!state.open_tx){state.balance_before_open=String(await retry(()=>c.getBalance({address:c.account.address})));save();state.open_tx=await retry(()=>c.writeContract({address:d.contracts.escrow.address,functionName:'open_claim',args:[state.audit_id],value:1000000000000000n,leaderOnly:false}),true);save();console.log({stage:'actual native deposit',hash:state.open_tx});}
await wait(state.open_tx);
if(!state.cancel_tx){const claim=await retry(()=>c.readContract({address:d.contracts.escrow.address,functionName:'get_claim',args:[state.audit_id]}));if(claim.status!=='OPEN'||claim.deposit_wei!==1000000000000000)throw new Error('Escrow did not record actual deposit');state.deposit_verified=true;save();state.cancel_tx=await retry(()=>c.writeContract({address:d.contracts.escrow.address,functionName:'cancel',args:[state.audit_id],value:0n,leaderOnly:false}),true);save();console.log({stage:'cancel and refund',hash:state.cancel_tx});}
const canceled=await wait(state.cancel_tx);
const raw=await retry(()=>c.request({method:'eth_getTransactionByHash',params:[state.cancel_tx]}));
for(const hash of raw.triggered_transactions||[])await wait(hash);
const claim=await retry(()=>c.readContract({address:d.contracts.escrow.address,functionName:'get_claim',args:[state.audit_id]}));const pool=await retry(()=>c.readContract({address:d.contracts.escrow.address,functionName:'get_pool',args:[]}));
if(claim.status!=='CANCELLED'||claim.deposit_wei!==0||pool.locked_wei!==0)throw new Error('Escrow refund state incorrect');
state.balance_after_refund=String(await retry(()=>c.getBalance({address:c.account.address})));if(state.balance_after_refund!==state.balance_before_open)throw new Error('Recipient did not receive the refund');state.refund_verified=true;state.triggered_transactions=raw.triggered_transactions;save();console.log('Actual Studio native deposit, linked verdict eligibility and finalized refund passed.');
if(!state.appeal_tx){state.appeal_tx=await retry(()=>c.writeContract({address:d.contracts.audit.address,functionName:'appeal',args:[state.audit_id],value:1000000000000000n,leaderOnly:false}),true);save();console.log({stage:'bonded independent recheck',hash:state.appeal_tx});}
await wait(state.appeal_tx);const appealed=await retry(()=>c.readContract({address:d.contracts.audit.address,functionName:'get_verdict',args:[state.audit_id]}));
if(!appealed.appealed||appealed.revision!==2||appealed.expected_cents!==9258)throw new Error('Bonded appeal state incorrect');state.appeal_verified=true;save();console.log('Bonded consensus recheck passed.');
