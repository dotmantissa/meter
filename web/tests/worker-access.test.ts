import {afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('../lib/worker',()=>({runWorker:mock.run}));
import {POST} from '../app/mcp/route';
afterEach(()=>{vi.unstubAllEnvs();mock.run.mockReset();});
const request=()=>new Request('https://meter.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({id:1,method:'tools/call',params:{name:'check_meter_tariffs',arguments:{}}})});
it('rejects a forged Sites identity header on the Vercel host',async()=>{
 vi.stubEnv('VERCEL','1');vi.stubEnv('WORKER_OWNER_ID','owner');
 const result=await(await POST(request())).json() as {result:{isError?:boolean}};expect(result.result.isError).toBe(true);expect(mock.run).not.toHaveBeenCalled();
});
it('preserves the authenticated owner tool on its Sites host',async()=>{
 vi.stubEnv('VERCEL','');vi.stubEnv('WORKER_OWNER_ID','owner');mock.run.mockResolvedValue({id:'run'});
 const result=await(await POST(request())).json() as {result:{isError?:boolean}};expect(result.result.isError).toBeUndefined();expect(mock.run).toHaveBeenCalledOnce();
});
