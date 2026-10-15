import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RecoveryPanel} from '../components/recovery-panel';
import {RevisionHistory} from '../components/revision-history';
import type {AuditRecord} from '../lib/facts';
const record={id:'a'.repeat(64),status:'FINALIZED',contract_version:2,operation_status:'FAILED',verdict:{classification:'MATCH',revision:3,difference_cents:0,material_hash:'new'},claim:{status:'OPEN',deposit_wei:1000,material_hash:'old'},history:[{revision:1,reason:'AUDIT',classification:'OVERCHARGE',expected_cents:1000},{revision:2,reason:'APPEAL',classification:'MATCH',expected_cents:1100,changed_this_revision:true},{revision:3,reason:'MONTHLY',classification:'MATCH',expected_cents:1100}]} as unknown as AuditRecord;
it('retains cancellation and correction refund controls after a MATCH and failed appeal',()=>{
 const html=renderToStaticMarkup(createElement(RecoveryPanel,{record,token:async()=>null,onRefresh:()=>{}}));
 expect(html).toContain('Cancel and refund');expect(html).toContain('Finish correction refund');expect(html).not.toContain('Open fee escrow');
 expect(html).not.toContain('disabled=""');
});
it('renders the complete available history after an unchanged confirmation',()=>{
 const html=renderToStaticMarkup(createElement(RevisionHistory,{record}));
 expect(html).toContain('Revision 1');expect(html).toContain('Revision 2');expect(html).toContain('Revision 3');expect(html).toContain('result changed');
});
it('keeps cancellation available even when the indexed verdict cannot be displayed',()=>{
 const html=renderToStaticMarkup(createElement(RecoveryPanel,{record:{...record,status:'FAILED',verdict:null},token:async()=>null,onRefresh:()=>{}}));
 expect(html).toContain('Cancel and refund');expect(html).not.toContain('disabled=""');
});
