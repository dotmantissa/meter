import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { createClient, createAccount } from '../web/node_modules/genlayer-js/dist/index.js';
import { studionet } from '../web/node_modules/genlayer-js/dist/chains/index.js';
import { transactionsStatusNumberToName, TransactionStatus } from '../web/node_modules/genlayer-js/dist/types/index.js';
import { catalog } from '../web/lib/catalog.ts';
process.loadEnvFile('.env');
const client=createClient({chain:studionet,account:createAccount(process.env.GENLAYER_PRIVATE_KEY)});
const manifest=JSON.parse(readFileSync('deployments/studio.json','utf8'));
function persist(){writeFileSync('deployments/studio.json.tmp',JSON.stringify(manifest,null,2)+'\n');renameSync('deployments/studio.json.tmp','deployments/studio.json');}
const index=[];
async function readRetry(fn) {
 while(true){
  try{return await fn();}
  catch(e){
   if(!String(e.details||e.message).includes('Rate limit exceeded') && !String(e.details||e.message).includes('Unexpected token'))throw e;
   console.log('RPC temporarily unavailable; waiting before resuming the recorded operation.');
   await new Promise(r=>setTimeout(r,60000));
  }
 }
}
async function sendRetry(fn){
 while(true){try{return await fn();}catch(e){
  if(!String(e.details||e.message).includes('Rate limit exceeded'))throw e;
  console.log('Submission rejected by the rate limiter. Waiting.');await new Promise(r=>setTimeout(r,60000));
 }}
}
async function receipt(hash){
 while(true){
  const tx=await readRetry(()=>client.getTransaction({hash}));
  const status=typeof tx.status==='number'?transactionsStatusNumberToName[String(tx.status)]:tx.status;
  if(status==='FINALIZED'||status==='CANCELED'||status==='UNDETERMINED')return tx;
  await new Promise(r=>setTimeout(r,20000));
 }
}

for(const tariff of catalog){
 const operation='register:'+tariff.id;
 let entry=manifest.operations[operation];
 if(!entry){
  const hash=await sendRetry(()=>client.writeContract({address:manifest.contracts.registry.address,functionName:'register',args:[tariff.id,tariff.utility_id,tariff.schedule_id,tariff.source_url,tariff.regulator_url,tariff.order_url,tariff.effective_from,tariff.effective_to],value:0n,leaderOnly:false}));
  entry=manifest.operations[operation]={tx_hash:hash,status:'SUBMITTED'};persist();console.log({tariff:tariff.id,hash});
 }
 if(entry.status!=='VERIFIED'){
  const tx=await receipt(entry.tx_hash);
  if(!(tx.consensus_data?.leader_receipt?.[0]?.execution_result==='SUCCESS')){
   entry.status='FAILED';persist();console.log({tariff:tariff.id,result:tx.consensus_data?.leader_receipt?.map(r=>({execution:r.execution_result,result:r.result}))});throw new Error('Registration did not execute successfully');
  }
  entry.status='VERIFIED';persist();
 }
 const actual=await readRetry(()=>client.readContract({address:manifest.contracts.registry.address,functionName:'get_tariff',args:[tariff.id]}));
 index.push({...actual,utility_name:tariff.utility_name,state:tariff.state});
 console.log({tariff:tariff.id,content_hash:actual.content_hash,status:'VERIFIED'});
}
mkdirSync('.contract-build',{recursive:true});writeFileSync('.contract-build/tariff-index.json',JSON.stringify(index,null,2)+'\n');
console.log('Index exported from actual registered contract state.');
