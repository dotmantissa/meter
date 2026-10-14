import { db } from './db';
import { addresses, operator, reader, userClient, plain } from './network';
import type { Tariff } from './facts';
import { executionSucceeded, refreshAudit, transactionStatus } from './audits';
export async function runWorker() {
  const sql = db(); const id = crypto.randomUUID();
  await sql`INSERT INTO meter_worker_runs(id) VALUES(${id})`;
  const chain = reader(); const contracts = addresses();
  let refreshed = 0, checked = 0;
  try {
    const due = await sql`UPDATE meter_audits SET lease_until=now()+interval '10 minutes' WHERE id IN (SELECT id FROM meter_audits WHERE recurring=true AND next_check_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND status='FINALIZED' ORDER BY next_check_at LIMIT 3 FOR UPDATE SKIP LOCKED) RETURNING id,user_id,facts`;
    for (const row of due) {
      try {
        const tariffId = row.facts.tariff_id;
        const jobs = await sql`SELECT * FROM meter_source_jobs WHERE tariff_id=${tariffId}`;
        const job = jobs[0];
        if (!job || (job.status === 'FINALIZED' && Date.now()-Date.parse(job.updated_at)>86400000)) {
          const lock = await sql`INSERT INTO meter_source_jobs(tariff_id,status,lease_until) VALUES(${tariffId},'SUBMITTING',now()+interval '10 minutes') ON CONFLICT(tariff_id) DO UPDATE SET status='SUBMITTING',tx_hash=NULL,lease_until=now()+interval '10 minutes' WHERE meter_source_jobs.status='FINALIZED' AND meter_source_jobs.updated_at<now()-interval '1 day' RETURNING tariff_id`;
          if (lock.length) {
            const hash = await operator().writeContract({ address: contracts.registry, functionName: 'refresh', args: [tariffId], value: 0n, leaderOnly: false });
            await sql`UPDATE meter_source_jobs SET tx_hash=${hash},status='PENDING',lease_until=NULL,updated_at=now() WHERE tariff_id=${tariffId}`;
          }
          await sql`UPDATE meter_audits SET next_check_at=now()+interval '2 hours',lease_until=NULL WHERE id=${row.id}`;
          continue;
        }
        if (job.status !== 'FINALIZED') {
          if (!job.tx_hash) { // Uncertain source broadcast requires operator reconciliation.
            await sql`UPDATE meter_audits SET error_code='SOURCE_REFRESH_UNCERTAIN',next_check_at=now()+interval '1 day',lease_until=NULL WHERE id=${row.id}`;
            continue;
          }
          const receipt = await chain.getTransaction({ hash: job.tx_hash });
          if (transactionStatus(receipt) !== 'FINALIZED') {
            await sql`UPDATE meter_audits SET next_check_at=now()+interval '2 hours',lease_until=NULL WHERE id=${row.id}`;
            continue;
          }
          if (!executionSucceeded(receipt)) throw new Error('SOURCE_REFRESH_REJECTED');
          await sql`UPDATE meter_source_jobs SET status='FINALIZED',updated_at=now() WHERE tariff_id=${tariffId}`;
          refreshed++;
        }
        const current = plain<Tariff>(await chain.readContract({ address: contracts.registry, functionName: 'get_tariff', args: [tariffId] }));
        await sql`UPDATE meter_tariffs SET changed_without_date=${current.changed_without_date},indexed_at=now() WHERE id=${tariffId}`;
        if (current.changed_without_date) {
          await sql`UPDATE meter_audits SET source_changed=true,next_check_at=now()+interval '1 month',lease_until=NULL WHERE id=${row.id}`;
        } else {
          await sql`UPDATE meter_audits SET status='SUBMITTING',operation='RECHECK',operation_tx=NULL,updated_at=now() WHERE id=${row.id}`;
          try {
            const tx = await (await userClient(row.user_id)).writeContract({ address: contracts.audit, functionName: 'recheck', args: [row.id], value: 0n, leaderOnly: false });
            await sql`UPDATE meter_audits SET operation_tx=${tx},status='PENDING',next_check_at=now()+interval '1 month',lease_until=NULL,updated_at=now() WHERE id=${row.id}`;
          } catch {
            await sql`UPDATE meter_audits SET status='SUBMISSION_UNCERTAIN',error_code='RELAY_UNCERTAIN',lease_until=NULL,updated_at=now() WHERE id=${row.id}`;
          }
        }
        checked++;
      } catch {
        await sql`UPDATE meter_audits SET next_check_at=now()+interval '1 day',lease_until=NULL,error_code='WORKER_RETRY' WHERE id=${row.id}`;
      }
    }
    const pending = await sql`SELECT id,user_id FROM meter_audits WHERE status NOT IN ('FINALIZED','FAILED','RECEIPT_UNAVAILABLE') AND tx_hash IS NOT NULL ORDER BY updated_at LIMIT 3`;
    for (const row of pending) await refreshAudit(row.id, row.user_id);
    await sql`UPDATE meter_worker_runs SET finished_at=now(),refreshed=${refreshed},checked=${checked} WHERE id=${id}`;
    return { id, refreshed, checked };
  } catch {
    await sql`UPDATE meter_worker_runs SET finished_at=now(),error_code='WORKER_FAILED' WHERE id=${id}`;
    throw new Error('WORKER_FAILED');
  }
}
