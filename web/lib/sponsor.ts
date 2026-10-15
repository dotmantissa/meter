import { db } from './db';
import { operator, type userClient } from './network';
import { HttpError } from './auth';
export async function ensureBondFunds(userId: string, client: Awaited<ReturnType<typeof userClient>>, value: bigint) {
  const address = client.account!.address;
  if (await client.getBalance({ address }) >= value) return;
  const sql = db();
  const reservation = await sql`SELECT meter_reserve_sponsorship(${userId}) AS reserved`;
  if (!reservation[0]?.reserved) throw new HttpError(503, 'Your bond sponsorship is pending or today’s allowance is used. Please check back later.');
  try {
    const sponsor = operator();
    const grant = BigInt('2000000000000000');
    if (await sponsor.getBalance({ address: sponsor.account!.address }) < grant) throw new Error('SPONSOR_EMPTY');
    const hash = await sponsor.sendTransaction({ account: sponsor.account!, to: address, value: grant });
    await sql`UPDATE meter_sponsorships SET tx_hash=${hash},status='SUBMITTED' WHERE user_id=${userId} AND day=CURRENT_DATE`;
    // Studio transfers may finish after this request. The next action checks actual balance.
    if (await client.getBalance({ address }) < value) throw new HttpError(409, 'Your Studio bond is being sponsored. Try this action again in a moment.');
    await sql`UPDATE meter_sponsorships SET status='FUNDED' WHERE user_id=${userId} AND day=CURRENT_DATE`;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await sql`UPDATE meter_sponsorships SET status=CASE WHEN tx_hash IS NULL THEN 'UNCERTAIN' ELSE status END WHERE user_id=${userId} AND day=CURRENT_DATE`;
    throw new HttpError(503, 'The Studio bond sponsor could not finish that request. Your verdict is ready to download.');
  }
}
