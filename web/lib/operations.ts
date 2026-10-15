import { db } from './db';
import { HttpError } from './auth';
import type { Address } from './network';
export const activeOperationStates = ['SUBMITTING','PENDING','ACCEPTED','PROPOSING','COMMITTING','REVEALING','UNCERTAIN','RECEIPT_UNAVAILABLE'];
export type OperationKind = 'APPEAL' | 'RECOVERY' | 'CANCEL' | 'REFUND' | 'RECHECK' | 'UPGRADE';
export type ContractSet = { audit: Address; escrow: Address; registry: Address };
export function recordContracts(row: Record<string, unknown>): ContractSet {
  return { audit: row.audit_address as Address, escrow: row.escrow_address as Address, registry: row.registry_address as Address };
}
export async function reserveOperation(auditId: string, userId: string, kind: OperationKind, target: ContractSet, version: number) {
  const id = crypto.randomUUID();
  const rows = await db()`WITH ticket AS (
    UPDATE meter_audits a SET current_operation_id=${id}::uuid
    WHERE a.id=${auditId} AND a.current_operation_id IS NULL
    RETURNING a.id
  ) INSERT INTO meter_operations(id,audit_id,kind,user_id,status,lease_until,target_audit,target_escrow,target_registry,target_version)
    SELECT ${id}::uuid,id,${kind},${userId},'SUBMITTING',now()+interval '2 minutes',${target.audit},${target.escrow},${target.registry},${version}
    FROM ticket RETURNING id`;
  if (!rows.length) throw new HttpError(409, 'Another action is still running. Its own receipt must finish before the next action.');
  return id;
}
export async function recordBroadcast(id: string, tx: string) {
  await db()`UPDATE meter_operations SET tx_hash=${tx},status='PENDING',lease_until=NULL,updated_at=now() WHERE id=${id}::uuid AND status IN ('SUBMITTING','UNCERTAIN') AND tx_hash IS NULL`;
}
export async function uncertainOperation(id: string) {
  await db()`UPDATE meter_operations SET status='UNCERTAIN',error_code='RELAY_UNCERTAIN',lease_until=NULL,updated_at=now() WHERE id=${id}::uuid AND status IN ('SUBMITTING','UNCERTAIN') AND tx_hash IS NULL`;
}
