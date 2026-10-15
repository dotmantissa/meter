// Real native payouts through the production escrow code and an isolated revision driver.
// The driver supplies controlled state changes only. It never adjudicates a customer bill.
import{readFileSync,writeFileSync,renameSync}from'node:fs';
import{createHmac}from'node:crypto';
import{createClient,createAccount}from'../web/node_modules/genlayer-js/dist/index.js';
import{studionet}from'../web/node_modules/genlayer-js/dist/chains/index.js';
process.loadEnvFile('.env');
const c=createClient({chain:studionet,account:createAccount(process.env.GENLAYER_PRIVATE_KEY)});
const run=process.env.METER_PROOF_RUN||'';
if(run&&!/^[a-zA-Z0-9_]{1,32}$/.test(run))throw new Error('Choose a short alphanumeric proof run identifier');
const user=createClient({chain:studionet,account:createAccount('0x'+createHmac('sha256',process.env.USER_SIGNER_SEED).update('meter:isolated:reviewer-refunds:'+(run||'20261015')).digest('hex'))});
const path='.contract-build/reviewer-refunds'+(run?'-'+run:'')+'.json';let state;try{state=JSON.parse(readFileSync(path));}catch{state={cases:{},kind:'ISOLATED_ESCROW_DRIVER'};}
function save(){writeFileSync(path+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(path+'.tmp',path);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function retry(fn,write=false){for(;;){try{return await fn();}catch(e){const message=String(e.details||e.message);if(write?!message.includes('Rate limit exceeded'):!/rate limit|fetch|network|socket|ECONNRESET|ETIMEDOUT|timeout|timed out|Unexpected token|Transaction not found|connection|HTTP.*50[234]/i.test(message))throw e;console.log('Waiting for Studio; retaining the same operation.');await sleep(60000);}}}
async function final(hash){for(;;){const tx=await retry(()=>c.getTransaction({hash}));if(tx.statusName==='FINALIZED'){if(tx.consensus_data?.leader_receipt?.[0]?.execution_result!=='SUCCESS'){const raw=await retry(()=>c.request({method:'eth_getTransactionByHash',params:[hash]}));if(raw.type!==0||raw.value_credited!==true)throw new Error('Unsuccessful execution '+hash);}return tx;}if(['CANCELED','UNDETERMINED'].includes(tx.statusName))throw new Error('Unsuccessful lifecycle '+hash);await sleep(25000);}}
async function descendants(hash){const tx=await final(hash);const raw=await retry(()=>c.request({method:'eth_getTransactionByHash',params:[hash]}));const children=raw.triggered_transactions||[];for(const child of children)await descendants(child);return{hash,type:tx.type,children};}
const read=(address,functionName,args=[])=>retry(()=>c.readContract({address,functionName,args}));
async function send(entry,key,address,functionName,args=[],value=0n){if(!entry[key]){entry[key]=await retry(()=>user.writeContract({address,functionName,args,value,leaderOnly:false}),true);save();console.log({functionName,hash:entry[key]});}return final(entry[key]);}
async function deploy(key,file,args){const signer=key==='driver'?user:c;const entry=state[key]||={};if(!entry.tx){entry.tx=await retry(()=>signer.deployContract({code:new Uint8Array(readFileSync(file)),args,leaderOnly:false}),true);save();}const tx=await final(entry.tx);entry.address=tx.to_address||tx.recipient;save();return entry.address;}
if(!state.funding_tx){state.funding_tx=await retry(()=>c.sendTransaction({to:user.account.address,value:3000000000000000n}),true);save();}
await final(state.funding_tx);
state.beneficiary=user.account.address;save();
const driver=await deploy('driver','tests/integration/contracts/revision_driver.py',[]);
const escrow=await deploy('escrow','contracts/recovery_escrow.py',[driver,1000]);
await send(state,'link_tx',driver,'link',[escrow]);
const deposit=1000000000000000n;
for(const name of ['automatic_correction','manual_correction','cancel_after_correction']){
 const entry=state.cases[name]||={};save();
 await send(entry,'seed_tx',driver,'seed',[name]);
 if(!entry.open_tx){entry.balance_before=String(await retry(()=>c.getBalance({address:user.account.address})));save();}
 await send(entry,'open_tx',escrow,'open_claim',[name],deposit);
 if(!entry.correct_tx){const claim=await read(escrow,'get_claim',[name]);if(claim.status!=='OPEN'||BigInt(claim.deposit_wei)!==deposit)throw new Error('Deposit not funded');}
 await send(entry,'correct_tx',driver,'correct',[name,name==='automatic_correction']);
 if(name==='automatic_correction')entry.payout_tree=await descendants(entry.correct_tx);
 else{
  const claim=await read(escrow,'get_claim',[name]);
  if(!entry.finish_tx&&claim.status!=='OPEN')throw new Error('Expected independently accessible open claim after MATCH');
  await send(entry,'finish_tx',escrow,name==='manual_correction'?'refund_changed':'cancel',[name]);
  entry.payout_tree=await descendants(entry.finish_tx);
 }
 const claim=await read(escrow,'get_claim',[name]);const pool=await read(escrow,'get_pool');
 if(!['REFUNDED','CANCELLED'].includes(claim.status)||BigInt(claim.refund_wei)!==deposit||BigInt(pool.locked_wei)!==0n)throw new Error('Correction did not release the full deposit');
 entry.balance_after=String(await retry(()=>c.getBalance({address:user.account.address})));
 if(entry.balance_after!==entry.balance_before)throw new Error('Native recipient balance was not restored');
 entry.claim=claim;entry.verified=true;save();
 // Permissionless synchronization is safe to retry after settlement.
 if(name==='manual_correction')await send(entry,'repeat_tx',escrow,'refund_changed',[name]);
 console.log({case:name,status:claim.status,native_balance_restored:true});
}
state.completed_at=new Date().toISOString();save();
