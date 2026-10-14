import { describe, expect, it } from 'vitest';
import { billFactsSchema, decimalInteger } from '../lib/facts';
import { extractBillFacts } from '../lib/bill-parser';
import { body, handler, HttpError, identity } from '../lib/auth';
const facts = { tariff_id: 'pse.7.2026', rate_class: '7', period_start: '2026-09-01', period_end: '2026-09-30', usage_wh: 700000, customer_cents: 749, energy_cents: 10106, bill_hash: 'a'.repeat(64), phase: 'single', dwelling: 'single_family' };
describe('The private bill boundary', () => {
  it('rejects identity fields instead of silently stripping them', () => {
    expect(billFactsSchema.safeParse({ ...facts, account_number: 'private' }).success).toBe(false);
    expect(billFactsSchema.safeParse({ ...facts, raw_text: 'private bill' }).success).toBe(false);
    expect(billFactsSchema.safeParse(facts).success).toBe(true);
  });
  it('keeps uncertain combined energy lines blank', () => {
    const draft = extractBillFacts('Puget Sound Energy Account 123456 Jane Sample 45 Sample Road Usage 700 kWh Basic Charge $7.49 Energy Charge $123.45 Schedule 7 09/01/2026 to 09/30/2026', 'a'.repeat(64));
    expect(draft).toMatchObject({ utility_id: 'pse', usage: '700', customer: '7.49', energy: undefined, start: '2026-09-01', needsReview: true });
    expect(JSON.stringify(draft)).not.toMatch(/Jane|Road|123456/);
  });
  it('does not choose between ambiguous quantities', () => {
    expect(extractBillFacts('Avista Usage 600 kWh Usage 700 kWh', 'a'.repeat(64)).usage).toBeUndefined();
  });
  it('requires exact decimals and valid monthly dates', () => {
    expect(decimalInteger('0.29', 100)).toBe(29);
    expect(decimalInteger('600.001', 1000)).toBe(600001);
    expect(() => decimalInteger('0.001', 100)).toThrow();
    expect(billFactsSchema.safeParse({ ...facts, period_start: '2026-02-30' }).success).toBe(false);
    expect(billFactsSchema.safeParse({ ...facts, usage_wh: -1 }).success).toBe(false);
  });
  it('rejects unauthorized access before touching a database or signer', async () => {
    await expect(identity(new Request('https://meter.test/api/audits'))).rejects.toMatchObject({ status: 401 });
  });
  it('does not echo provider errors or secrets', async () => {
    const res = await handler(async () => { throw new Error('postgresql://secret:password@host token=private'); });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/postgresql|password|token=|private/);
    const unauthorized = await handler(async () => { throw new HttpError(401, 'Sign in'); });
    expect(unauthorized.status).toBe(401);
  });
  it('rejects files and large bodies at the API boundary', async () => {
    await expect(body(new Request('https://meter.test', { method: 'POST', body: 'file' }))).rejects.toMatchObject({ status: 415 });
    await expect(body(new Request('https://meter.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(12001) }))).rejects.toMatchObject({ status: 413 });
  });
});
