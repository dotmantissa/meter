import { db } from './db';
import { operator, reader, userClient, plain } from './network';
import type { Tariff } from './facts';
import { executionSucceeded, refreshAudit, transactionStatus } from './audits';
import { recordContracts, reserveOperation, recordBroadcast, uncertainOperation } from './operations';
export async function runWorker() {
  const sql = db(); const id = crypto.randomUUID();
  await sql`INSERT INTO meter_worker_runs(id) VALUES(${id})`;
  const chain = reader(); let refreshed = 0, checked = 0;
  try {
    const due = await sql`UPDATE meter_audits SET lease_until=now()+interval '10 minutes'
      WHERE id IN (SELECT id FROM meter_audits WHERE recurring=true AND next_check_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) AND status='FINALIZED' AND current_operation_id IS NULL
      ORDER BY next_check_at LIMIT 3 FOR UPDATE SKIP LOCKED) RETURNING *`;
    for (const row of due) {
      try {
        if (row.contract_version < 2) {
          await sql`UPDATE meter_audits SET error_code='LEGACY_UPGRADE_REQUIRED',next_check_at=now()+interval '1 month',lease_until=NULL WHERE id=${row.id}`;
          continue;
        }
        const contracts = recordContracts(row);
        const tariffId = row.facts.tariff_id;
        const jobId = contracts.registry + ':' + tariffId;
        const jobs = await sql`SELECT * FROM meter_source_jobs WHERE tariff_id=${jobId}`;
        const job = jobs[0];
        const retryDue = job?.status==='FAILED' && (!job.retry_at || Date.parse(job.retry_at)<=Date.now());
        if (!job || retryDue || (job.status==='FINALIZED' && Date.now()-Date.parse(job.updated_at)>86400000)) {
          const lock = await sql`INSERT INTO meter_source_jobs(tariff_id,registry_address,status,attempts,lease_until)
            VALUES(${jobId},${contracts.registry},'SUBMITTING',1,now()+interval '10 minutes')
            ON CONFLICT(tariff_id) DO UPDATE SET status='SUBMITTING',tx_hash=NULL,attempts=meter_source_jobs.attempts+1,
              error_code=NULL,lease_until=now()+interval '10 minutes',updated_at=now()
            WHERE (meter_source_jobs.status='FAILED' AND (meter_source_jobs.retry_at IS NULL OR meter_source_jobs.retry_at<=now()))
              OR (meter_source_jobs.status='FINALIZED' AND meter_source_jobs.updated_at<now()-interval '1 day') RETURNING tariff_id`;
          if (lock.length) {
            try {
              const hash = await operator().writeContract({address:contracts.registry,functionName:'refresh',args:[tariffId],value:BigInt(0),leaderOnly:false});
              await sql`UPDATE meter_source_jobs SET tx_hash=${hash},status='PENDING',lease_until=NULL,updated_at=now() WHERE tariff_id=${jobId} AND status='SUBMITTING'`;
            } catch {
              await sql`UPDATE meter_source_jobs SET status='UNCERTAIN',error_code='SOURCE_BROADCAST_UNCERTAIN',lease_until=NULL,updated_at=now() WHERE tariff_id=${jobId} AND status='SUBMITTING'`;
            }
          }
          await sql`UPDATE meter_audits SET next_check_at=now()+interval '1 hour',lease_until=NULL WHERE id=${row.id}`;
          continue;
        }
        if (job.status!=='FINALIZED') {
          if (!job.tx_hash) {
            if (job.status==='SUBMITTING' && Date.parse(job.lease_until)<Date.now()) await sql`UPDATE meter_source_jobs SET status='UNCERTAIN',error_code='SOURCE_BROADCAST_UNCERTAIN',updated_at=now() WHERE tariff_id=${jobId} AND tx_hash IS NULL AND status='SUBMITTING'`;
            await sql`UPDATE meter_audits SET error_code='SOURCE_REFRESH_UNCERTAIN',next_check_at=now()+interval '1 day',lease_until=NULL WHERE id=${row.id}`;
            continue;
          }
          if (job.status==='FAILED') {
            await sql`UPDATE meter_audits SET next_check_at=COALESCE(${job.retry_at}::timestamptz,now()+interval '1 hour'),lease_until=NULL WHERE id=${row.id}`;
            continue;
          }
          const receipt=await chain.getTransaction({hash:job.tx_hash});const state=transactionStatus(receipt);
          if (['CANCELED','UNDETERMINED'].includes(state) || (state==='FINALIZED' && !executionSucceeded(receipt))) {
            // This is a confirmed terminal failure, so a later run may safely reserve a new submission.
            await sql`UPDATE meter_source_jobs SET status='FAILED',error_code='SOURCE_REFRESH_REJECTED',
              retry_at=now()+LEAST(attempts,24)*interval '15 minutes',lease_until=NULL,updated_at=now()
              WHERE tariff_id=${jobId} AND tx_hash=${job.tx_hash}`;
            await sql`UPDATE meter_audits SET error_code='SOURCE_REFRESH_RETRY',next_check_at=now()+interval '1 hour',lease_until=NULL WHERE id=${row.id}`;
            continue;
          }
          if (state!=='FINALIZED') {
            await sql`UPDATE meter_audits SET next_check_at=now()+interval '1 hour',lease_until=NULL WHERE id=${row.id}`;
            continue;
          }
          await sql`UPDATE meter_source_jobs SET status='FINALIZED',error_code=NULL,retry_at=NULL,updated_at=now() WHERE tariff_id=${jobId} AND tx_hash=${job.tx_hash}`;
          refreshed++;
        }
        const current=plain<Tariff>(await chain.readContract({address:contracts.registry,functionName:'get_tariff',args:[tariffId]}));
        await sql`UPDATE meter_tariffs SET changed_without_date=${current.changed_without_date},indexed_at=now() WHERE id=${tariffId}`;
        await sql`UPDATE meter_audits SET source_changed=${current.changed_without_date} WHERE id=${row.id}`;
        const client=await userClient(row.user_id);
        const policy=plain<{monthly_after:number}>(await chain.readContract({address:contracts.audit,functionName:'get_policy',args:[row.id,client.account!.address]}));
        if (policy.monthly_after>Date.now()/1000) {
          await sql`UPDATE meter_audits SET next_check_at=to_timestamp(${policy.monthly_after}),lease_until=NULL WHERE id=${row.id}`;
          continue;
        }
        const op=await reserveOperation(row.id,row.user_id,'RECHECK',contracts,row.contract_version);
        try {
          const tx=await client.writeContract({address:contracts.audit,functionName:'recheck',args:[row.id],value:BigInt(0),leaderOnly:false});
          await recordBroadcast(op,tx);
        } catch { await uncertainOperation(op); }
        await sql`UPDATE meter_audits SET next_check_at=now()+interval '31 days',lease_until=NULL,error_code=NULL WHERE id=${row.id}`;
        checked++;
      } catch {
        await sql`UPDATE meter_audits SET next_check_at=now()+interval '1 day',lease_until=NULL,error_code='WORKER_RETRY' WHERE id=${row.id}`;
      }
    }
    const pending=await sql`SELECT id,user_id FROM meter_audits WHERE status NOT IN ('FINALIZED','FAILED') OR current_operation_id IS NOT NULL ORDER BY updated_at LIMIT 3`;
    for (const row of pending) await refreshAudit(row.id,row.user_id);
    await sql`UPDATE meter_worker_runs SET finished_at=now(),refreshed=${refreshed},checked=${checked} WHERE id=${id}`;
    return {id,refreshed,checked};
  } catch {
    await sql`UPDATE meter_worker_runs SET finished_at=now(),error_code='WORKER_FAILED' WHERE id=${id}`;
    throw new Error('WORKER_FAILED');
  }
}
