import { handler, identity } from '@/lib/auth';
import { actOnAudit } from '@/lib/actions';
import { plain, reader } from '@/lib/network';
import { db } from '@/lib/db';
import { recordContracts } from '@/lib/operations';
import { refreshAudit } from '@/lib/audits';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await context.params;
    await refreshAudit(id, await identity(request));
    const escrow=recordContracts((await db()`SELECT * FROM meter_audits WHERE id=${id}`)[0]).escrow;
    const claim=plain(await reader().readContract({ address:escrow, functionName: 'get_claim', args: [id] }));
    await db()`UPDATE meter_audits SET claim_snapshot=${JSON.stringify(claim)}::jsonb WHERE id=${id} AND escrow_address=${escrow}`;
    return claim;
  });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handler(async () => actOnAudit(await identity(request), (await context.params).id, 'RECOVERY')); }
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return handler(async () => actOnAudit(await identity(request), (await context.params).id, 'CANCEL')); }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return handler(async () => actOnAudit(await identity(request), (await context.params).id, 'REFUND')); }
