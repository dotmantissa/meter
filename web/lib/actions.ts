import { db } from './db';
import { ensureBondFunds } from './sponsor';
import { HttpError } from './auth';
import { addresses, userClient, reader, plain } from './network';
import type { Verdict } from './facts';
export async function actOnAudit(userId: string, id: string, kind: 'APPEAL' | 'RECOVERY' | 'CANCEL') {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(404, 'That review could not be found.');
  const sql = db(); const rows = await sql`SELECT * FROM meter_audits WHERE id=${id} AND user_id=${userId}`;
  if (!rows.length) throw new HttpError(404, 'That review could not be found.');
  const row = rows[0];
  if (row.status !== 'FINALIZED') throw new HttpError(409, 'Wait for the current review to finish.');
  const client = await userClient(userId); const contracts = addresses();
  const v = plain<Verdict>(await reader().readContract({ address: contracts.audit, functionName: 'get_verdict', args: [id] }));
  if (kind === 'APPEAL' && v.appealed) throw new HttpError(409, 'This review has already been rechecked.');
  if (kind === 'RECOVERY' && (!['OVERCHARGE', 'RATE_CLASS'].includes(v.classification) || v.difference_cents < 1000)) throw new HttpError(422, 'A recovery claim needs at least $10 in disputed base charges.');
  const value = kind === 'CANCEL' ? BigInt(0) : BigInt("1000000000000000");
  if (value > BigInt(0)) await ensureBondFunds(userId, client, value);
  const locked = await sql`UPDATE meter_audits SET status='SUBMITTING',operation=${kind},previous_tx=COALESCE(operation_tx,tx_hash),operation_tx=NULL,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=${id} AND user_id=${userId} AND status='FINALIZED' RETURNING id`;
  if (!locked.length) throw new HttpError(409, 'Another action is already running.');
  try {
    const tx = await client.writeContract({ address: kind === 'APPEAL' ? contracts.audit : contracts.escrow, functionName: kind === 'APPEAL' ? 'appeal' : kind === 'RECOVERY' ? 'open_claim' : 'cancel', args: [id], value, leaderOnly: false });
    await sql`UPDATE meter_audits SET operation_tx=${tx},status='PENDING',lease_until=NULL,updated_at=now() WHERE id=${id}`;
    return { tx_hash: tx, status: 'PENDING' };
  } catch {
    await sql`UPDATE meter_audits SET status='SUBMISSION_UNCERTAIN',error_code='RELAY_UNCERTAIN',updated_at=now() WHERE id=${id}`;
    throw new HttpError(503, 'We could not confirm the submission. Check the saved review before trying again.');
  }
}
