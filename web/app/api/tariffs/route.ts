import { handler } from '@/lib/auth';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET() { return handler(async () => ({ tariffs: await db()`SELECT *,effective_from::text,effective_to::text FROM meter_tariffs ORDER BY utility_name`, scope: 'BASE_CHARGES' })); }
