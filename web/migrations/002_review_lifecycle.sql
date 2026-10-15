ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS audit_address text NOT NULL DEFAULT '0x50FF44E251eAEea0269A98B595e9E6F5e3249339';
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS escrow_address text NOT NULL DEFAULT '0x8B5F125286114A389fFb3A0f35ff1dC0F6C28469';
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS registry_address text NOT NULL DEFAULT '0x3a742eb2A1e8559b54adB5A9edD24d1FBdb5393c';
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS contract_version integer NOT NULL DEFAULT 1;
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS current_operation_id uuid;
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS verdict_checked_at timestamptz;
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS verdict_check_error text;
-- meter:statement
CREATE TABLE IF NOT EXISTS meter_operations (
 id uuid PRIMARY KEY, audit_id text NOT NULL REFERENCES meter_audits(id),
 kind text NOT NULL, user_id text NOT NULL, tx_hash text, status text NOT NULL,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, target_audit text NOT NULL, target_escrow text NOT NULL,
 target_registry text NOT NULL, target_version integer NOT NULL
);
-- meter:statement
CREATE TABLE IF NOT EXISTS meter_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
-- meter:statement
WITH first_run AS (
 INSERT INTO meter_migrations(id) VALUES('operations-v2') ON CONFLICT DO NOTHING RETURNING id
), imported AS (
 INSERT INTO meter_operations(id,audit_id,kind,user_id,tx_hash,status,error_code,lease_until,target_audit,target_escrow,target_registry,target_version)
 SELECT gen_random_uuid(),id,operation,user_id,operation_tx,
 CASE WHEN status='FAILED' THEN 'FAILED' WHEN status='FINALIZED' AND operation_tx IS NOT NULL THEN 'FINALIZED' WHEN operation_tx IS NULL THEN 'UNCERTAIN' ELSE 'PENDING' END,
 error_code,lease_until,audit_address,escrow_address,registry_address,contract_version
 FROM meter_audits WHERE operation<>'AUDIT' AND EXISTS(SELECT 1 FROM first_run) RETURNING id,audit_id,status
)
UPDATE meter_audits a SET current_operation_id=CASE WHEN o.status NOT IN ('FAILED','FINALIZED') THEN o.id ELSE NULL END,
 status=CASE WHEN a.tx_hash IS NOT NULL THEN 'PENDING' ELSE 'RECEIPT_UNAVAILABLE' END,
 operation='AUDIT',operation_tx=NULL,error_code=NULL FROM imported o WHERE a.id=o.audit_id;
-- meter:statement
ALTER TABLE meter_source_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
-- meter:statement
ALTER TABLE meter_source_jobs ADD COLUMN IF NOT EXISTS retry_at timestamptz;
-- meter:statement
ALTER TABLE meter_source_jobs ADD COLUMN IF NOT EXISTS error_code text;
-- meter:statement
ALTER TABLE meter_source_jobs ADD COLUMN IF NOT EXISTS registry_address text;
-- meter:statement
CREATE TABLE IF NOT EXISTS meter_sponsor_budgets (day date PRIMARY KEY, reserved integer NOT NULL CHECK(reserved>=0 AND reserved<=100));
-- meter:statement
INSERT INTO meter_sponsor_budgets(day,reserved) SELECT day,LEAST(count(*),100) FROM meter_sponsorships GROUP BY day ON CONFLICT DO NOTHING;
-- meter:statement
CREATE OR REPLACE FUNCTION meter_reserve_sponsorship(request_user text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO meter_sponsorships(user_id,status) VALUES(request_user,'SUBMITTING') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO meter_sponsor_budgets(day,reserved) VALUES(CURRENT_DATE,1)
 ON CONFLICT(day) DO UPDATE SET reserved=meter_sponsor_budgets.reserved+1 WHERE meter_sponsor_budgets.reserved<100;
 IF NOT FOUND THEN
  DELETE FROM meter_sponsorships WHERE user_id=request_user AND day=CURRENT_DATE;
  RETURN false;
 END IF;
 RETURN true;
END;
$$;

-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS verdict_synced_at timestamptz;
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS claim_snapshot jsonb;
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS history_snapshot jsonb;
-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS history_start integer;
-- meter:statement
CREATE UNIQUE INDEX IF NOT EXISTS meter_one_active_operation ON meter_operations(audit_id) WHERE status NOT IN ('FINALIZED','FAILED');

-- meter:statement
ALTER TABLE meter_audits ADD COLUMN IF NOT EXISTS legacy_audit_tx text;
