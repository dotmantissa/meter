CREATE TABLE IF NOT EXISTS meter_tariffs (
  id text PRIMARY KEY, utility_id text NOT NULL, utility_name text NOT NULL,
  schedule_id text NOT NULL, state text NOT NULL, source_url text NOT NULL,
  regulator_url text NOT NULL, order_url text NOT NULL,
  effective_from date NOT NULL, effective_to date NOT NULL,
  content_hash text NOT NULL, changed_without_date boolean NOT NULL DEFAULT false,
  indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meter_audits (
  id text PRIMARY KEY, user_id text NOT NULL, facts jsonb NOT NULL,
  tx_hash text, status text NOT NULL DEFAULT 'SUBMITTING', verdict jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  public boolean NOT NULL DEFAULT false, recurring boolean NOT NULL DEFAULT false,
  next_check_at timestamptz, source_changed boolean NOT NULL DEFAULT false,
  operation text NOT NULL DEFAULT 'AUDIT', error_code text,
  operation_tx text, previous_tx text, lease_until timestamptz
);
CREATE INDEX IF NOT EXISTS meter_audits_user ON meter_audits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meter_audits_due ON meter_audits(next_check_at) WHERE recurring;
CREATE TABLE IF NOT EXISTS meter_quotas (
  user_id text NOT NULL, day date NOT NULL, count integer NOT NULL, PRIMARY KEY(user_id,day)
);
CREATE TABLE IF NOT EXISTS meter_worker_runs (
  id text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  refreshed integer NOT NULL DEFAULT 0, checked integer NOT NULL DEFAULT 0, error_code text
);
CREATE TABLE IF NOT EXISTS meter_source_jobs (
 tariff_id text PRIMARY KEY, tx_hash text, status text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz
);
CREATE TABLE IF NOT EXISTS meter_sponsorships (
 user_id text NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, status text NOT NULL,
 tx_hash text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,day)
);
