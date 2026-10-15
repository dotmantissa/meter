'use client';
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api} from '@/lib/client-api';
import type {AuditRecord} from '@/lib/facts';
export function RecoveryPanel({record,token,onRefresh}:{record:AuditRecord;token:()=>Promise<string|null>;onRefresh:(record:AuditRecord)=>void}) {
 const [working,setWorking]=useState(false);const [message,setMessage]=useState('');
 const claim=record.claim;const verdict=record.verdict;
 const pending=!!record.operation_status&&!['FAILED','FINALIZED'].includes(record.operation_status);
 const eligible=!!verdict&&verdict.difference_cents>=1000&&['OVERCHARGE','RATE_CLASS'].includes(verdict.classification);
 const changed=claim?.status==='OPEN'&&claim.material_hash&&verdict?.material_hash&&claim.material_hash!==verdict.material_hash;
 async function act(method:string){setWorking(true);setMessage('');try{await api(`/api/audits/${record.id}/recovery`,await token(),{method});onRefresh({...record,operation_status:'PENDING'});setMessage('Submitted. The deposit moves only after the network finalizes its payout.');}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}}
 async function inspect(){setWorking(true);try{const value=await api<NonNullable<AuditRecord['claim']>>(`/api/audits/${record.id}/recovery`,await token());onRefresh({...record,claim:value});setMessage('Claim read from the contract.');}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}}
 return <div className="appeal-box"><h4>Your recovery deposit</h4><p>Claim access stays here even if a later verdict changes or an action fails. Studio GEN has no stated dollar value.</p><button className="button quiet small" disabled={working} onClick={inspect}>Check claim</button>
 {claim?.status==='OPEN'&&<><p>Your deposit is still open.{changed?' The verdict changed, so a full refund is available.':''}</p><button className="button quiet small" disabled={working||pending} onClick={()=>void act('DELETE')}>Cancel and refund</button>{changed&&record.contract_version!==1&&<button className="button quiet small" disabled={working||pending} onClick={()=>void act('PATCH')}><RefreshCw size={15}/> Finish correction refund</button>}</>}
 {eligible&&claim?.status==='NONE'&&record.contract_version!==1&&record.status==='FINALIZED'&&<><p>A claim escrows 0.001 Studio GEN. The operator attests a utility credit. The fee is released in proportion to the amount recovered, and the remainder is refunded.</p><button className="button quiet small" disabled={working||pending} onClick={()=>void act('POST')}>Open fee escrow</button></>}
 {claim&&['CANCELLED','REFUNDED','RECOVERED','PARTIAL'].includes(claim.status)&&<p>Claim status: {claim.status.toLowerCase()}. Payouts are queued as separate transactions and must finalize before balances change.</p>}
 {message&&<p className="action-message" role="status">{message}</p>}</div>;
}
