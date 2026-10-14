import { body, handler, identity } from '@/lib/auth';
import { db } from '@/lib/db';
import { submitAudit } from '@/lib/audits';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handler(async () => {
    const user = await identity(request);
    return db()`SELECT id,tx_hash,status,verdict,created_at,public,recurring,source_changed,operation,error_code,operation_tx FROM meter_audits WHERE user_id=${user} ORDER BY created_at DESC LIMIT 40`;
  });
}
export async function POST(request: Request) { return handler(async () => submitAudit(await identity(request), await body(request))); }
