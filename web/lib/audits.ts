import { db } from './db';
import { addresses, plain, reader, userClient } from './network';
import { HttpError } from './auth';
import { billFactsSchema, type AuditRecord, type Verdict } from './facts';
import { transactionsStatusNumberToName, type GenLayerTransaction } from 'genlayer-js/types';
export function executionSucceeded(tx: GenLayerTransaction) {
  return String(tx.txExecutionResultName) === 'FINISHED_WITH_RETURN' || tx.consensus_data?.leader_receipt?.some(r => r.execution_result === 'SUCCESS') === true;
}
export function transactionStatus(tx: GenLayerTransaction) {
  return String(tx.statusName || (typeof tx.status === 'number' ? transactionsStatusNumberToName[String(tx.status) as keyof typeof transactionsStatusNumberToName] : tx.status) || 'PENDING');
}
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function canonical(value: Record<string, unknown>) { return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]]))); }
export async function submitAudit(userId: string, input: unknown) {
  const parsed = billFactsSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Check the bill summary.');
  const facts = parsed.data;
  const sql = db();
  const sources = await sql`SELECT id, effective_from::text, effective_to::text, changed_without_date FROM meter_tariffs WHERE id=${facts.tariff_id}`;
  const tariff = sources[0];
  if (!tariff || tariff.changed_without_date) throw new HttpError(422, 'This tariff needs a fresh source review.');
  if (facts.period_start < tariff.effective_from || facts.period_end > tariff.effective_to) throw new HttpError(422, 'This bill falls outside the tariff dates. A bill spanning a rate change needs a separate review.');
  const client = await userClient(userId);
  const id = await sha256(client.account!.address + canonical(facts));
  const existing = await sql`SELECT * FROM meter_audits WHERE id=${id} AND user_id=${userId}`;
  if (existing.length) return existing[0];
  const quota = await sql`INSERT INTO meter_quotas(user_id,day,count) VALUES(${userId},CURRENT_DATE,1)
    ON CONFLICT(user_id,day) DO UPDATE SET count=meter_quotas.count+1 WHERE meter_quotas.count<3 RETURNING count`;
  if (!quota.length) throw new HttpError(429, 'Three reviews in a day is our limit for now. Come back tomorrow.');
  const inserted = await sql`INSERT INTO meter_audits(id,user_id,facts,lease_until) VALUES(${id},${userId},${JSON.stringify(facts)}::jsonb,now()+interval '2 minutes') ON CONFLICT(id) DO NOTHING RETURNING id`;
  if (!inserted.length) return (await sql`SELECT * FROM meter_audits WHERE id=${id} AND user_id=${userId}`)[0];
  try {
    const tx = await client.writeContract({ address: addresses().audit, functionName: 'audit_bill', args: [canonical(facts)], value: 0n, leaderOnly: false });
    await sql`UPDATE meter_audits SET tx_hash=${tx}, status='PENDING', updated_at=now(), lease_until=NULL WHERE id=${id}`;
  } catch {
    await sql`UPDATE meter_audits SET status='SUBMISSION_UNCERTAIN', error_code='RELAY_UNCERTAIN', updated_at=now() WHERE id=${id}`;
    // A transport error may follow successful broadcast. Do not blindly resubmit.
  }
  return (await sql`SELECT * FROM meter_audits WHERE id=${id} AND user_id=${userId}`)[0];
}
export async function refreshAudit(id: string, userId?: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(404, 'That review could not be found.');
  const sql = db();
  const rows = userId ? await sql`SELECT * FROM meter_audits WHERE id=${id} AND user_id=${userId}` : await sql`SELECT * FROM meter_audits WHERE id=${id} AND public=true`;
  if (!rows.length) throw new HttpError(404, 'That review is private or could not be found.');
  let row = rows[0];
  const chain = reader();
  if (row.status === 'SUBMISSION_UNCERTAIN' || (row.status === 'SUBMITTING' && Date.parse(row.lease_until) < Date.now())) {
    try {
      const verdict = plain<Verdict>(await chain.readContract({ address: addresses().audit, functionName: 'get_verdict', args: [id] }));
      // Recovery from uncertain broadcast must not invent a finalized receipt.
      await sql`UPDATE meter_audits SET verdict=${JSON.stringify(verdict)}::jsonb,status='RECEIPT_UNAVAILABLE',error_code='RECEIPT_UNAVAILABLE',updated_at=now() WHERE id=${id}`;
      row = { ...row, verdict, status: 'RECEIPT_UNAVAILABLE' };
    } catch { /* Keep the recovery state visible until receipt reconciliation. */ }
  }
  const txHash = row.operation_tx || row.tx_hash;
  if (txHash && !['FINALIZED', 'FAILED', 'RECEIPT_UNAVAILABLE'].includes(row.status) && Date.now() - Date.parse(row.updated_at) > 6000) {
    const lock = await sql`UPDATE meter_audits SET updated_at=now() WHERE id=${id} AND updated_at<now()-interval '6 seconds' RETURNING id`;
    if (lock.length) {
      try {
        const tx = await chain.getTransaction({ hash: txHash });
        const status = transactionStatus(tx);
        if (status === 'FINALIZED' && executionSucceeded(tx)) {
          const verdict = plain<Verdict>(await chain.readContract({ address: addresses().audit, functionName: 'get_verdict', args: [id] }));
          await sql`UPDATE meter_audits SET status='FINALIZED',verdict=${JSON.stringify(verdict)}::jsonb,error_code=NULL WHERE id=${id}`;
        } else if (['FINALIZED', 'ACCEPTED'].includes(status) && !executionSucceeded(tx)) {
          await sql`UPDATE meter_audits SET status='FAILED',error_code='CONTRACT_REJECTED' WHERE id=${id}`;
        } else if (['CANCELED', 'UNDETERMINED'].includes(status)) {
          await sql`UPDATE meter_audits SET status='FAILED',error_code='NO_VERDICT' WHERE id=${id}`;
        } else {
          await sql`UPDATE meter_audits SET status=${status} WHERE id=${id}`;
        }
      } catch { /* A temporary RPC failure leaves the last known state intact. */ }
      row = (await sql`SELECT * FROM meter_audits WHERE id=${id}`)[0];
    }
  }
  const result = { ...row }; delete result.user_id; delete result.lease_until; delete result.facts;
  return result as AuditRecord;
}
