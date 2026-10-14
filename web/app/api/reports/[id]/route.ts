import { handler } from '@/lib/auth';
import { refreshAudit } from '@/lib/audits';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return handler(async () => refreshAudit((await context.params).id)); }
