import { db } from './db';
import { ensureBondFunds } from './sponsor';
import { HttpError } from './auth';
import { refreshAudit } from './audits';
import { recordContracts, reserveOperation, recordBroadcast, uncertainOperation, type OperationKind } from './operations';
import { addresses, userClient, reader, plain } from './network';
import type { Verdict } from './facts';
export async function actOnAudit(userId: string, id: string, kind: Exclude<OperationKind,'RECHECK'>) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(404, 'That review could not be found.');
  const sql = db();
  const rows = await sql`SELECT * FROM meter_audits WHERE id=${id} AND (user_id=${userId} OR (${kind}='APPEAL' AND public=true))`;
  if (!rows.length) throw new HttpError(404, 'That review could not be found.');
  let row = rows[0];
  // Reconcile receipts without letting an auxiliary failure invalidate the original review.
  const record = await refreshAudit(id, row.user_id);
  row=(await sql`SELECT * FROM meter_audits WHERE id=${id}`)[0];
  const contracts = recordContracts(row);
  const client = await userClient(userId);
  const chain = reader();
  if (kind !== 'CANCEL' && record.status !== 'FINALIZED') throw new HttpError(409, 'Wait for the original audit receipt to finish.');
  if (row.contract_version < 2 && ['APPEAL','RECOVERY','REFUND'].includes(kind)) throw new HttpError(409, 'Move this legacy review to archived evidence first. Existing deposits can always be cancelled below.');
  let target = contracts;
  if (kind === 'UPGRADE') {
    if (row.contract_version >= 2) throw new HttpError(409, 'This review already uses archived evidence.');
    const claim = plain<{status:string}>(await chain.readContract({address:contracts.escrow,functionName:'get_claim',args:[id]}));
    if (claim.status === 'OPEN') throw new HttpError(409, 'Cancel and refund the existing legacy claim before moving this review.');
    target = addresses();
  }
  if (kind === 'CANCEL') {
    const claim = plain<{status:string}>(await chain.readContract({address:contracts.escrow,functionName:'get_claim',args:[id]}));
    if (claim.status !== 'OPEN') throw new HttpError(409, 'There is no open deposit to cancel.');
  }
  if (kind === 'RECOVERY') {
    const v = plain<Verdict>(await chain.readContract({address:contracts.audit,functionName:'get_verdict',args:[id]}));
    if (!['OVERCHARGE','RATE_CLASS'].includes(v.classification) || v.difference_cents < 1000) throw new HttpError(422, 'A new claim needs at least $10 in disputed base charges.');
  }
  let value = BigInt(0);
  if (kind === 'APPEAL') {
    const policy = plain<{bond_wei:number;challenge_after:number}>(await chain.readContract({address:contracts.audit,functionName:'get_policy',args:[id,client.account!.address]}));
    if (policy.challenge_after > Date.now()/1000) throw new HttpError(409, 'Your next bonded review is available after the one hour waiting period. Other challengers keep their own access.');
    value = BigInt(policy.bond_wei);
  } else if (kind === 'RECOVERY') value = BigInt('1000000000000000');
  // Fund before acquiring the operation ticket. A reservation alone never authorizes a duplicate write.
  if (value > BigInt(0)) await ensureBondFunds(userId,client,value);
  const op = await reserveOperation(id,userId,kind,target,kind==='UPGRADE'?2:row.contract_version);
  try {
    const tx = await client.writeContract({address: ['APPEAL','UPGRADE'].includes(kind)?target.audit:target.escrow,
      functionName: kind==='APPEAL'?'appeal':kind==='RECOVERY'?'open_claim':kind==='CANCEL'?'cancel':kind==='REFUND'?'refund_changed':'import_legacy',
      args:[id],value,leaderOnly:false});
    await recordBroadcast(op,tx);
    return {tx_hash:tx,operation_status:'PENDING'};
  } catch {
    await uncertainOperation(op);
    throw new HttpError(503,'The broadcast needs reconciliation. Your verdict is still available; do not submit the same action again.');
  }
}
