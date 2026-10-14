import { body, handler, HttpError, identity } from '@/lib/auth';
import { refreshAudit } from '@/lib/audits';
import { db } from '@/lib/db';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async () => refreshAudit((await context.params).id, await identity(request)));
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const user = await identity(request); const { id } = await context.params;
    const parsed = z.object({ public: z.boolean().optional(), recurring: z.boolean().optional() }).strict().safeParse(await body(request));
    if (!parsed.success) throw new HttpError(400, 'Check your sharing preference.');
    const updated = await db()`UPDATE meter_audits SET public=COALESCE(${parsed.data.public ?? null},public), recurring=COALESCE(${parsed.data.recurring ?? null},recurring), next_check_at=CASE WHEN ${parsed.data.recurring ?? null}=true THEN now()+interval '1 month' WHEN ${parsed.data.recurring ?? null}=false THEN NULL ELSE next_check_at END WHERE id=${id} AND user_id=${user} RETURNING id,public,recurring`;
    if (!updated.length) throw new HttpError(404, 'That review could not be found.');
    return updated[0];
  });
}
