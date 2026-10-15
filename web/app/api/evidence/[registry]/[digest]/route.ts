import {addresses,reader} from '@/lib/network';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{registry:string;digest:string}>}) {
 const {registry,digest}=await context.params;
 if(registry.toLowerCase()!==addresses().registry.toLowerCase()||!/^[a-f0-9]{64}$/.test(digest)) return Response.json({error:'Archived evidence not found.'},{status:404});
 try {
  const bytes=await reader().readContract({address:addresses().registry,functionName:'get_document',args:[digest]});
  if(!(bytes instanceof Uint8Array)) throw new Error('INVALID_ARCHIVE');
  const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
  if(Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')!==digest) throw new Error('ARCHIVE_MISMATCH');
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="meter-evidence-${digest}.pdf"`,'Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
 } catch {return Response.json({error:'The archived source is temporarily unavailable. Its fingerprint remains in the verdict.'},{status:503});}
}
