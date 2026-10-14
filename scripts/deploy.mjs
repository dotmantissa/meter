import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient, createAccount } from '../web/node_modules/genlayer-js/dist/index.js';
import { studionet } from '../web/node_modules/genlayer-js/dist/chains/index.js';
import { TransactionStatus } from '../web/node_modules/genlayer-js/dist/types/index.js';
process.loadEnvFile('.env');
const client = createClient({ chain: studionet, account: createAccount(process.env.GENLAYER_PRIVATE_KEY) });
mkdirSync('deployments', { recursive: true });
const path = 'deployments/studio.json';
const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { network: 'studionet', chain_id: 61999, rpc: 'https://studio.genlayer.com/api', deployer: client.account.address, contracts: {}, operations: {} };
function persist() { writeFileSync(path + '.tmp', JSON.stringify(manifest, null, 2)+'\n'); renameSync(path+'.tmp',path); }
function success(tx) {
  return tx.txExecutionResultName === 'SUCCESS' || tx.consensus_data?.leader_receipt?.some(r => r.execution_result === 'SUCCESS');
}
for (const [name, file, args] of [
  ['registry','contracts/tariff_registry.py',[]],
  ['audit','.contract-build/meter_audit.zip',null],
  ['escrow','contracts/recovery_escrow.py',null],
]) {
  const code = readFileSync(file); const digest = createHash('sha256').update(code).digest('hex');
  let entry = manifest.contracts[name];
  if (entry && entry.code_sha256 !== digest) throw new Error('Local code changed since deployment: '+name+'. Reconcile the manifest before replacing it.');
  if (!entry) {
    const actualArgs = args ?? (name === 'audit' ? [manifest.contracts.registry.address, 1000000000000000] : [manifest.contracts.audit.address, 1000]);
    let hash;
    while (!hash) {
      try { hash = await client.deployContract({ code: new Uint8Array(code), args: actualArgs, leaderOnly: false }); }
      catch (error) {
        if (!String(error.details || error.message).includes('Rate limit exceeded')) throw error;
        console.log('Studio rate limit reached. Waiting before retrying this rejected submission.');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
    entry = manifest.contracts[name] = { tx_hash: hash, code_sha256: digest, args: actualArgs, status: 'SUBMITTED' }; persist();
    console.log(JSON.stringify({ name, hash, status: 'SUBMITTED' }));
  }
  if (!entry.address) {
    const tx = await client.waitForTransactionReceipt({ hash: entry.tx_hash, status: TransactionStatus.FINALIZED, interval: 15000, retries: 100 });
    entry.status = tx.statusName || tx.status;
    entry.execution = tx.txExecutionResultName || tx.consensus_data?.leader_receipt?.map(r=>r.execution_result);
    entry.address = tx.txDataDecoded?.contractAddress || tx.data?.contract_address || tx.to_address || tx.recipient;
    persist();
    if (!success(tx)) { delete entry.address;persist();console.log(JSON.stringify({name,status:entry.status,execution:entry.execution,debug:tx.consensus_data?.leader_receipt?.map(r=>({error:r.error,result:r.result}))})); throw new Error('Contract execution failed: '+name); }
    if (!entry.address) throw new Error('No deployed address in successful receipt');
    await client.getContractSchema(entry.address);
  }
  console.log(JSON.stringify({name,address:entry.address,status:entry.status,execution:entry.execution}));
}
console.log('All three deployed contracts have readable schemas.');
