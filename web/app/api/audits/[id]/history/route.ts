import { handler, HttpError, identity } from '@/lib/auth';
import { refreshAudit } from '@/lib/audits';
import { db } from '@/lib/db';
import { plain, reader } from '@/lib/network';
import { recordContracts } from '@/lib/operations';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
 return handler(async()=>{
  const {id}=await context.params;const user=request.headers.has('authorization')?await identity(request):undefined;
  const access=(await db()`SELECT user_id FROM meter_audits WHERE id=${id} AND (public=true OR user_id=${user||''})`)[0];
  if(!access) throw new HttpError(404,'That review is private or could not be found.');
  await refreshAudit(id,access.user_id===user?user:undefined);
  const row=(await db()`SELECT * FROM meter_audits WHERE id=${id}`)[0];
  if(row.contract_version<2) return {history:[],legacy:true};
  const start=Number(new URL(request.url).searchParams.get('start')||1);
  if(!Number.isSafeInteger(start)||start<1) throw new HttpError(400,'Choose a valid revision.');
  return {history:plain(await reader().readContract({address:recordContracts(row).audit,functionName:'get_history',args:[id,start,20]}))};
 });
}
