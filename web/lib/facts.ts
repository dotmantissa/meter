import { z } from 'zod';
const identifier = z.string().min(1).max(80).regex(/^[A-Za-z0-9._]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Check the billing date');
export const billFactsSchema = z.object({
  tariff_id: identifier, rate_class: identifier,
  period_start: isoDate, period_end: isoDate,
  usage_wh: z.number().int().nonnegative().max(1_000_000_000),
  customer_cents: z.number().int().nonnegative().max(1_000_000_000),
  energy_cents: z.number().int().nonnegative().max(1_000_000_000),
  bill_hash: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['single', 'three']), dwelling: z.enum(['single_family', 'multi_family']),
}).strict().superRefine((v, ctx) => {
  const days = (Date.parse(v.period_end) - Date.parse(v.period_start)) / 86400000 + 1;
  if (days < 27 || days > 35) ctx.addIssue({ code: 'custom', path: ['period_end'], message: 'Choose a regular monthly bill of 27 to 35 days' });
});
export type BillFacts = z.infer<typeof billFactsSchema>;
export type Tariff = { id: string; utility_id: string; utility_name: string; schedule_id: string; state: string; source_url: string; regulator_url: string; order_url: string; effective_from: string; effective_to: string; content_hash: string; regulatory_hash?: string; order_hash?: string; changed_without_date: boolean; indexed_at: string };
export type Verdict = { id: string; classification: 'MATCH' | 'OVERCHARGE' | 'UNDERCHARGE' | 'RATE_CLASS' | 'INSUFFICIENT_EVIDENCE'; expected_cents: number; billed_cents: number; difference_cents: number; energy_cents: number; customer_cents: number; revision: number; scope: 'BASE_CHARGES'; facts: BillFacts; tariff: Tariff; material_hash?: string; material_revision?: number; reason?: string; legacy_origin?: {contract:string;revision:number}; actor?: string; recorded_at?: number; changed_this_revision?: boolean; corrected?: boolean; appealed?: boolean; previous_classification?: string; parameters: { basic_micro_usd: number; tiers: { up_to_wh: number; micro_usd_per_kwh: number }[]; required_class: string; reason_code: string } };
export type AuditRecord = { id: string; tx_hash: string | null; status: string; verdict: Verdict | null; created_at: string; public: boolean; recurring: boolean; source_changed: boolean; operation: string; error_code: string | null; operation_tx: string | null; operation_status?: string | null; operation_error?: string | null; contract_version?: number; audit_address?:string; escrow_address?:string; legacy_audit_tx?:string|null; registry_address?: string; verdict_check_error?: string | null; verdict_synced_at?: string | null; history?: Verdict[]; history_start?: number; claim?: {status: string;deposit_wei?: number;fee_wei?: number;refund_wei?: number;material_hash?: string} | null };
export function money(cents: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
export function decimalInteger(value: string, scale: number): number {
  const digits = Math.log10(scale);
  if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error('Use a positive number');
  const [whole, fraction = ''] = value.trim().split('.');
  if (fraction.length > digits) throw new Error(`Use at most ${digits} decimal places`);
  const result = Number(whole) * scale + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('That number is too large');
  return result;
}
