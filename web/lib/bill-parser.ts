import { decimalInteger } from './facts';
export type BillDraft = { utility_id?: string; usage?: string; customer?: string; energy?: string; rateClass?: string; start?: string; end?: string; hash: string; needsReview: boolean; warning?: string };
export function extractBillFacts(text: string, hash: string): BillDraft {
  // Only known numeric patterns are copied. Raw PDF text stays within this call.
  const utility_id = /puget sound energy|\bpse\b/i.test(text) ? 'pse' : /avista/i.test(text) ? 'avista' : /pacific power/i.test(text) ? 'pacific' : undefined;
  const usageMatches = [...text.matchAll(/(?:total\s+(?:electric\s+)?(?:usage|used)|energy\s+used|usage)\s*[:\s]*([\d,]+(?:\.\d{1,3})?)\s*kwh/gi)];
  const usage = usageMatches.length === 1 ? usageMatches[0][1].replaceAll(',', '') : undefined;
  const customerMatches = [...text.matchAll(/(?:basic|customer)\s+charge\s*\$?\s*([\d,]+\.\d{2})\b/gi)];
  const customer = customerMatches.length === 1 ? customerMatches[0][1].replaceAll(',', '') : undefined;
  // Do not mistake a combined rider-inclusive energy line for base energy charges.
  const energyMatches = [...text.matchAll(/base\s+(?:energy|electricity)\s+charge\s*\$?\s*([\d,]+\.\d{2})\b/gi)];
  const energy = energyMatches.length === 1 ? energyMatches[0][1].replaceAll(',', '') : undefined;
  const schedule = text.match(/(?:rate\s+schedule|schedule|rate\s+class)\s*[:#]?\s*(\d{1,3})\b/i)?.[1];
  const periods = [...text.matchAll(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*(?:to|through|\u2013|\u002d)\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/g)];
  const normalize = (v: string) => v.includes('/') ? `${v.slice(6)}-${v.slice(0, 2)}-${v.slice(3, 5)}` : v;
  return { utility_id, usage, customer, energy, rateClass: schedule?.replace(/^0+/, '') || undefined, start: periods.length === 1 ? normalize(periods[0][1]) : undefined, end: periods.length === 1 ? normalize(periods[0][2]) : undefined, hash, needsReview: true, warning: !energy ? 'Your bill does not clearly separate base energy charges. Enter the base subtotal from its rate lines. Leave riders and taxes out.' : undefined };
}
export async function parseBill(file: File): Promise<BillDraft> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a PDF smaller than 15 MB.');
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('That file is not a PDF.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 20) throw new Error('Choose the bill itself, with no more than 20 pages.');
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
      if (text.length > 150_000) throw new Error('This PDF has too much text to review safely.');
    }
    if (text.trim().length < 80) throw new Error('This looks like a scanned bill. Use a PDF with selectable text. Your file has stayed in this browser.');
    return extractBillFacts(text, hash);
  } finally { await task.destroy(); }
}
export function draftNumber(v: string, scale: number) { return decimalInteger(v, scale); }
