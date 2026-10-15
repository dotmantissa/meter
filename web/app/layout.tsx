import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { BackToTop } from '@/components/back-to-top';
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/public-sans/latin-400.css';
import '@fontsource/public-sans/latin-500.css';
import '@fontsource/public-sans/latin-600.css';
import './globals.css';
export const metadata: Metadata = { title: 'Meter | A fair bill feels better', description: 'Give your electricity bill a second look. Private bill parsing and independent reviews against the published tariff.', icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' }, openGraph: { title: 'Meter | A fair bill feels better', description: 'The utility wrote the bill. That doesn’t have to be the last word.', images: ['/social.svg'] } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><body><a className="skip-link" href="#main-content">Skip to content</a><Providers><div id="main-content" tabIndex={-1}>{children}</div><BackToTop/></Providers></body></html>;
}
