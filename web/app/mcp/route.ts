import { db } from '@/lib/db';
import { runWorker } from '@/lib/worker';
import { body } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  let input: { id?: string | number; method?: string; params?: { name?: string; arguments?: unknown } };
  try { input = await body(request) as typeof input; } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  const result = (value: unknown) => Response.json({ jsonrpc: '2.0', id: input.id ?? null, result: value });
  if (input.method === 'server/discover') return result({ supportedVersions: ['2026-07-28', '2025-03-26'], capabilities: { tools: {} } });
  if (input.method === 'initialize') return result({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Meter tariff checks', version: '1.0.0' } });
  if (input.method === 'notifications/initialized') return new Response(null, { status: 204 });
  if (input.method === 'tools/list') return result({ tools: [
    { name: 'check_meter_tariffs', description: 'Refresh authoritative public tariff sources and independently recheck anonymous bill facts for owners who consented to monthly checks. Only the Site owner may run it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'meter_worker_status', description: 'Read the most recent tariff check run and count queued consented reviews. Only the Site owner may read it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ] });
  if (input.method === 'tools/call') {
    const owner = process.env.WORKER_OWNER_ID;
    if (!owner || request.headers.get('oai-authenticated-user-id') !== owner) return result({ content: [{ type: 'text', text: 'Only the Meter Site owner can run this worker.' }], isError: true });
    const args = input.params?.arguments;
    if (args && (typeof args !== 'object' || Object.keys(args).length)) return result({ content: [{ type: 'text', text: 'This tool does not accept parameters.' }], isError: true });
    try {
      if (input.params?.name === 'check_meter_tariffs') return result({ content: [{ type: 'text', text: JSON.stringify(await runWorker()) }] });
      if (input.params?.name === 'meter_worker_status') {
        const sql = db(); const runs = await sql`SELECT id,started_at,finished_at,refreshed,checked,error_code FROM meter_worker_runs ORDER BY started_at DESC LIMIT 1`;
        const queued = await sql`SELECT count(*)::int AS count FROM meter_audits WHERE recurring=true AND next_check_at<=now()`;
        return result({ content: [{ type: 'text', text: JSON.stringify({ latest_run: runs[0] || null, due: queued[0].count }) }] });
      }
      return result({ content: [{ type: 'text', text: 'Unknown tool.' }], isError: true });
    } catch { return result({ content: [{ type: 'text', text: 'Meter could not finish this run. Its saved jobs can be resumed.' }], isError: true }); }
  }
  return Response.json({ jsonrpc: '2.0', id: input.id ?? null, error: { code: -32601, message: 'Method not found' } });
}
