import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
export type Address = `0x${string}`;
export function addresses() {
  const registry = process.env.TARIFF_REGISTRY_ADDRESS as Address;
  const audit = process.env.METER_AUDIT_ADDRESS as Address;
  const escrow = process.env.RECOVERY_ESCROW_ADDRESS as Address;
  if (![registry, audit, escrow].every(v => /^0x[a-fA-F0-9]{40}$/.test(v || ''))) throw new Error('CONFIG_CONTRACTS');
  return { registry, audit, escrow };
}
export function reader() { return createClient({ chain: studionet }); }
export function operator() {
  const key = process.env.GENLAYER_PRIVATE_KEY as Address;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key || '')) throw new Error('CONFIG_SIGNER');
  return createClient({ chain: studionet, account: createAccount(key) });
}
export async function userClient(userId: string) {
  const seed = process.env.USER_SIGNER_SEED;
  if (!seed) throw new Error('CONFIG_SIGNER');
  const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode('meter.studio.user.v1:' + userId));
  const key = '0x' + Array.from(new Uint8Array(derived), b => b.toString(16).padStart(2, '0')).join('');
  return createClient({ chain: studionet, account: createAccount(key as Address) });
}
export function plain<T>(value: unknown): T { return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v)) as T; }
