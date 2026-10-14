import { handler } from '@/lib/auth';
import { addresses, plain, reader } from '@/lib/network';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handler(async () => {
    await db()`SELECT 1`;
    const contracts = addresses();
    const pool = plain(await reader().readContract({ address: contracts.escrow, functionName: 'get_pool', args: [] }));
    return { network: 'GenLayer Studio', chain_id: 61999, contracts, pool, privy_app_id: process.env.PRIVY_APP_ID, checked_at: new Date().toISOString() };
  });
}
