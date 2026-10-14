import { handler } from '@/lib/auth';
import { addresses, plain, reader } from '@/lib/network';
import { catalog } from '@/lib/catalog';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handler(async () => {
    const month = new URL(request.url).searchParams.get('month') || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Choose a valid month.' };
    const chain = reader(); const rows = [];
    for (const tariff of catalog) rows.push({ utility: tariff.utility_name, tariff_id: tariff.id, counts: plain(await chain.readContract({ address: addresses().audit, functionName: 'get_stats', args: [tariff.id, month] })) });
    return { month, scope: 'BASE_CHARGES', network: 'studionet', counts_include: 'All contract audits, including direct submissions. Counts represent user supplied facts, not proven utility misconduct.', rows };
  });
}
