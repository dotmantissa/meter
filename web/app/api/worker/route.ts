import { handler, HttpError } from '@/lib/auth';
import { runWorker } from '@/lib/worker';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handler(async () => {
    const expected = process.env.WORKER_SECRET;
    if (!expected || request.headers.get('authorization') !== 'Bearer ' + expected) throw new HttpError(401, 'Worker access required.');
    return runWorker();
  });
}
