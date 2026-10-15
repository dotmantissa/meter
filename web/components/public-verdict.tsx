'use client';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/client-api';
import { VerdictView } from './verdict-view';
import type { AuditRecord } from '@/lib/facts';
export function PublicVerdict({ id }: { id: string }) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const [record, setRecord] = useState<AuditRecord | null>(null); const [error, setError] = useState('');
  useEffect(() => { api<AuditRecord>(`/api/reports/${id}`).then(setRecord).catch(e => setError(e.message)); }, [id]);
  useEffect(() => {
    if (!record) return;
    const timer = setInterval(() => { api<AuditRecord>(`/api/reports/${id}`).then(setRecord).catch(e => setError(e.message)); }, record.operation_status&&!['FINALIZED','FAILED'].includes(record.operation_status)?12000:60000);
    return () => clearInterval(timer);
  }, [record, id]);
  return <main className="public-report wrap"><h1>A bill, with the working attached.</h1><p className="report-intro">An independent Meter record, shared by its owner.</p><div className="paper-panel"><div className="paper-header"><span><FileText size={18}/> Public verdict</span><span>GenLayer Studio</span></div>{error ? <p className="feedback error" role="alert">{error}</p> : record ? <VerdictView key={record.id} record={record} publicView token={getAccessToken} onRefresh={setRecord} onSignIn={!authenticated ? () => login({loginMethods:['email']}) : undefined}/> : <p className="busy-note"><LoaderCircle className="spin" size={18}/> Opening the public record…</p>}</div></main>;
}
