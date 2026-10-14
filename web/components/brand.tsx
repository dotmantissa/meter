import Link from 'next/link';
export function Mark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M7 29V20a13 13 0 0 1 26 0v9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/><path d="M13 29v-9a7 7 0 0 1 14 0v9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/><path d="m20 24 9-13" stroke="#d53142" strokeWidth="3.5" strokeLinecap="round"/><circle cx="20" cy="24" r="3" fill="#d53142"/></svg>;
}
export function Brand() { return <Link href="/" className="brand" aria-label="Meter home"><Mark /><span>meter<span className="brand-dot">.</span></span></Link>; }
