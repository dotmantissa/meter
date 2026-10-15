'use client';
import {useState} from 'react';
import {api} from '@/lib/client-api';
import {money,type AuditRecord,type Verdict} from '@/lib/facts';
export function RevisionHistory({record,token}:{record:AuditRecord;token?:()=>Promise<string|null>}) {
 const [earlier,setEarlier]=useState<Verdict[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const history=[...earlier,...(record.history||[])].filter((v,i,all)=>all.findIndex(x=>x.revision===v.revision)===i).sort((a,b)=>a.revision-b.revision);
 const start=history[0]?.revision||1;
 const origin=record.verdict?.legacy_origin||history.find(v=>v.legacy_origin)?.legacy_origin;
 async function load(){setBusy(true);try{const next=await api<{history:Verdict[]}>(`/api/audits/${record.id}/history?start=${Math.max(1,start-20)}`,await token?.());setEarlier([...next.history,...earlier]);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <details className="evidence"><summary>Revision history</summary><div className="evidence-body">{origin&&<p>This review began on the earlier contract <code>{origin.contract}</code> at revision {origin.revision}. Its latest legacy snapshot was preserved here. Older legacy transactions were not a complete stored history.</p>}{record.contract_version===1?<p>This legacy contract did not preserve a complete revision history. Its transaction records remain available. Move the review to archived evidence to retain future revisions.</p>:<>{history.map(v=><div className="tier-line" key={v.revision}><span>Revision {v.revision}: {v.reason?.toLowerCase().replaceAll('_',' ')}{v.changed_this_revision?' · result changed':''}</span><span>{v.classification.toLowerCase().replaceAll('_',' ')} · {money(v.expected_cents)}</span></div>)}{start>1&&<button className="button quiet small" disabled={busy} onClick={load}>Earlier revisions</button>}{!history.length&&<button className="button quiet small" disabled={busy} onClick={load}>Read contract history</button>}</>}{error&&<p role="alert">{error}</p>}</div></details>;
}
