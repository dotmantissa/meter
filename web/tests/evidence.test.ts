import {it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({read:vi.fn()}));
const registry='0x'+'1'.repeat(40);
vi.mock('../lib/network',()=>({addresses:()=>({registry:'0x'+'1'.repeat(40)}),reader:()=>({readContract:mock.read})}));
import {GET} from '../app/api/evidence/[registry]/[digest]/route';
const pdf=new TextEncoder().encode('%PDF-1.7\nPublic tariff evidence');
async function digest(){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pdf)),byte=>byte.toString(16).padStart(2,'0')).join('');}
it('serves the actual PDF when Studio returns contract bytes as a hex string',async()=>{
 mock.read.mockResolvedValue('0x'+Array.from(pdf,byte=>byte.toString(16).padStart(2,'0')).join(''));
 const result=await GET(new Request('https://meter.test'),{params:Promise.resolve({registry,digest:await digest()})});
 expect(result.status).toBe(200);expect(result.headers.get('Content-Type')).toBe('application/pdf');expect(new Uint8Array(await result.arrayBuffer())).toEqual(pdf);
});
it('also accepts native bytes and rejects an archive that fails its committed hash',async()=>{
 mock.read.mockResolvedValue(pdf);
 expect((await GET(new Request('https://meter.test'),{params:Promise.resolve({registry,digest:await digest()})})).status).toBe(200);
 expect((await GET(new Request('https://meter.test'),{params:Promise.resolve({registry,digest:'a'.repeat(64)})})).status).toBe(503);
});
it('does not proxy unapproved registries or invalid document identifiers',async()=>{
 mock.read.mockClear();
 expect((await GET(new Request('https://meter.test'),{params:Promise.resolve({registry:'0x'+'2'.repeat(40),digest:await digest()})})).status).toBe(404);
 expect(mock.read).not.toHaveBeenCalled();
});
