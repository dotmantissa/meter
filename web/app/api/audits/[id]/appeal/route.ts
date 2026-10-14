import { handler, identity } from '@/lib/auth';
import { actOnAudit } from '@/lib/actions';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async () => actOnAudit(await identity(request), (await context.params).id, 'APPEAL'));
}
