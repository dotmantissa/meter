import { PrivyClient } from '@privy-io/server-auth';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function identity(request: Request): Promise<string> {
  const bearer = request.headers.get('authorization');
  if (!bearer?.startsWith('Bearer ')) throw new HttpError(401, 'Sign in with your email to continue.');
  const appId = process.env.PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) throw new HttpError(503, 'Email access is temporarily unavailable.');
  try {
    const privy = new PrivyClient(appId, secret);
    const verified = await privy.verifyAuthToken(bearer.slice(7));
    const user = await privy.getUser(verified.userId);
    if (!user.email) throw new Error('Email required');
    return verified.userId;
  } catch { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }
}
export async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Send structured bill facts.');
  const raw = await request.text();
  if (raw.length > 12_000) throw new HttpError(413, 'Only the small bill summary can be sent.');
  try { return JSON.parse(raw) as unknown; } catch { throw new HttpError(400, 'Check the bill summary.'); }
}
export async function handler(run: () => Promise<unknown>) {
  try { return Response.json(await run(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    // Never return SDK traces, provider bodies, database errors, or credential-bearing URLs.
    return Response.json({ error: 'The service could not finish that request. Your saved review is safe. Try again shortly.' }, { status: 503 });
  }
}
