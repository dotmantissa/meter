import { handler, HttpError } from '@/lib/auth';
import { runWorker } from '@/lib/worker';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
function authorize(request: Request) {
  const expected = process.env.WORKER_SECRET;
  const service = process.env.WORKER_SITE_SERVICE_TOKEN;
  const authorization = request.headers.get('authorization');
  if ((!expected || authorization !== 'Bearer ' + expected) && (!service || authorization !== 'Bearer ' + service)) throw new HttpError(401, 'Worker access required.');
}
export async function POST(request: Request) { return handler(async () => { authorize(request); return runWorker(); }); }
export async function GET(request: Request) {
  return handler(async () => {
    authorize(request);
    const rows = await db()`SELECT id,started_at,finished_at,refreshed,checked,error_code FROM meter_worker_runs ORDER BY started_at DESC LIMIT 1`;
    return { latest_run: rows[0] || null };
  });
}
