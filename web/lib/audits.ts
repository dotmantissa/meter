import { db } from './db';
import { addresses, plain, reader, userClient } from './network';
import { HttpError } from './auth';
import { recordContracts } from './operations';
import { billFactsSchema, type AuditRecord, type Verdict } from './facts';
import { transactionsStatusNumberToName, type GenLayerTransaction } from 'genlayer-js/types';
export function executionSucceeded(tx: GenLayerTransaction) {
  const receipt = tx.consensus_data?.leader_receipt?.[0];
  return receipt ? receipt.execution_result === 'SUCCESS' : ['FINISHED_WITH_RETURN','SUCCESS'].includes(String(tx.txExecutionResultName));
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
  const inserted = await sql`INSERT INTO meter_audits(id,user_id,facts,lease_until,audit_address,escrow_address,registry_address,contract_version) VALUES(${id},${userId},${JSON.stringify(facts)}::jsonb,now()+interval '2 minutes',${addresses().audit},${addresses().escrow},${addresses().registry},2) ON CONFLICT(id) DO NOTHING RETURNING id`;
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
  // This receipt establishes only the original audit. Auxiliary actions never use it.
  if (row.tx_hash && !['FINALIZED','FAILED'].includes(row.status)) {
    try {
      const tx = await chain.getTransaction({ hash: row.tx_hash });
      const status = transactionStatus(tx);
      if (status === 'FINALIZED') {
        const succeeded = executionSucceeded(tx);
        await sql`UPDATE meter_audits SET status=${succeeded ? 'FINALIZED' : 'FAILED'},error_code=${succeeded ? null : 'AUDIT_REJECTED'},updated_at=now() WHERE id=${id}`;
      } else if (['CANCELED','UNDETERMINED'].includes(status)) {
        await sql`UPDATE meter_audits SET status='FAILED',error_code='AUDIT_NOT_EXECUTED',updated_at=now() WHERE id=${id}`;
      }
    } catch { /* Keep the original receipt lifecycle independent of index availability. */ }
  }
  await sql`UPDATE meter_audits SET current_operation_id=NULL WHERE id=${id} AND current_operation_id IN (SELECT id FROM meter_operations WHERE audit_id=${id} AND status IN ('FINALIZED','FAILED'))`;
  const operations = await sql`SELECT * FROM meter_operations WHERE audit_id=${id} ORDER BY created_at DESC LIMIT 1`;
  let op = operations[0];
  if (op && !['FINALIZED','FAILED'].includes(op.status)) {
    if (!op.tx_hash) {
      if (op.status === 'SUBMITTING' && Date.parse(op.lease_until) < Date.now()) {
        await sql`UPDATE meter_operations SET status='UNCERTAIN',error_code='RELAY_UNCERTAIN',updated_at=now() WHERE id=${op.id}::uuid AND status='SUBMITTING' AND tx_hash IS NULL`;
      }
    } else {
      try {
        const tx = await chain.getTransaction({ hash: op.tx_hash });
        const status = transactionStatus(tx);
        if (['FINALIZED','CANCELED','UNDETERMINED'].includes(status)) {
          const ok = status === 'FINALIZED' && executionSucceeded(tx);
          if (ok && op.kind === 'UPGRADE') {
            // Complete the receipt and address switch atomically. A concurrent refresh
            // must never release this ticket before its provenance has been installed.
            await sql`WITH completed AS (
              UPDATE meter_operations SET status='FINALIZED',error_code=NULL,updated_at=now()
              WHERE id=${op.id}::uuid AND tx_hash=${op.tx_hash} RETURNING id
            ) UPDATE meter_audits SET audit_address=${op.target_audit},escrow_address=${op.target_escrow},registry_address=${op.target_registry},contract_version=${op.target_version},legacy_audit_tx=COALESCE(legacy_audit_tx,tx_hash),tx_hash=${op.tx_hash},verdict=NULL,history_snapshot=NULL,history_start=NULL,claim_snapshot=NULL,verdict_synced_at=NULL,verdict_checked_at=NULL,current_operation_id=NULL
              WHERE id=${id} AND current_operation_id IN (SELECT id FROM completed)`;
          } else {
            await sql`UPDATE meter_operations SET status=${ok ? 'FINALIZED' : 'FAILED'},error_code=${ok ? null : 'ACTION_REJECTED'},updated_at=now() WHERE id=${op.id}::uuid AND tx_hash=${op.tx_hash}`;
            await sql`UPDATE meter_audits SET current_operation_id=NULL WHERE id=${id} AND current_operation_id=${op.id}::uuid`;
          }
        }
      } catch { /* A known auxiliary hash is retried; no fallback to the audit hash. */ }
    }
  }
  row = (await sql`SELECT * FROM meter_audits WHERE id=${id}`)[0];
  const contracts = recordContracts(row);
  // Finalized reviews must still follow later direct contract appeals and confirmations.
  const lock = await sql`UPDATE meter_audits SET verdict_checked_at=now() WHERE id=${id} AND (verdict_checked_at IS NULL OR verdict_checked_at<now()-interval '6 seconds') RETURNING id`;
  if (lock.length) {
    try {
      const verdict = plain<Verdict>(await chain.readContract({ address: contracts.audit, functionName: 'get_verdict', args: [id] }));
      await sql`UPDATE meter_audits SET verdict=${JSON.stringify(verdict)}::jsonb,verdict_check_error=NULL,verdict_synced_at=now() WHERE id=${id} AND audit_address=${contracts.audit} AND (verdict IS NULL OR COALESCE((verdict->>'revision')::int,0)<=${verdict.revision})`;
    } catch {
      await sql`UPDATE meter_audits SET verdict_check_error='CONTRACT_READ_UNAVAILABLE' WHERE id=${id} AND audit_address=${contracts.audit}`;
    }
  }
  row = (await sql`SELECT * FROM meter_audits WHERE id=${id}`)[0];
  if (lock.length) {
    try {
      const claim = plain(await chain.readContract({address:contracts.escrow,functionName:'get_claim',args:[id]}));
      await sql`UPDATE meter_audits SET claim_snapshot=${JSON.stringify(claim)}::jsonb WHERE id=${id} AND escrow_address=${contracts.escrow}`;
    } catch { /* Keep the previous claim visible and cancel controls available. */ }
    if (row.verdict && row.contract_version>=2) {
      const start=Math.max(1,row.verdict.revision-19);
      try {
        const history=plain(await chain.readContract({address:contracts.audit,functionName:'get_history',args:[id,start,20]}));
        await sql`UPDATE meter_audits SET history_snapshot=${JSON.stringify(history)}::jsonb,history_start=${start} WHERE id=${id} AND audit_address=${contracts.audit} AND (verdict->>'revision')::int=${row.verdict.revision}`;
      } catch { /* Contract history remains available through the paginated endpoint. */ }
    }
    row=(await sql`SELECT * FROM meter_audits WHERE id=${id}`)[0];
  }
  op=(await sql`SELECT * FROM meter_operations WHERE audit_id=${id} ORDER BY created_at DESC LIMIT 1`)[0];
  const result:Record<string,unknown>={...row,operation:op?.kind||'AUDIT',operation_status:op?.status||null,
    operation_tx:op?.tx_hash||null,operation_error:op?.error_code||null,
    history:row.history_snapshot||[],claim:row.claim_snapshot||null};
  delete result.user_id; delete result.lease_until; delete result.facts; delete result.current_operation_id; delete result.claim_snapshot; delete result.history_snapshot;
  return result as AuditRecord;
}
