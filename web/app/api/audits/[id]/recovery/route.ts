import { handler, identity } from '@/lib/auth';
import { actOnAudit } from '@/lib/actions';
import { addresses, plain, reader } from '@/lib/network';
import { refreshAudit } from '@/lib/audits';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await context.params;
    await refreshAudit(id, await identity(request));
    return plain(await reader().readContract({ address: addresses().escrow, functionName: 'get_claim', args: [id] }));
  });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handler(async () => actOnAudit(await identity(request), (await context.params).id, 'RECOVERY')); }
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return handler(async () => actOnAudit(await identity(request), (await context.params).id, 'CANCEL')); }
