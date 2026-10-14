'use client';
import { PrivyProvider } from '@privy-io/react-auth';
export function Providers({ children }: { children: React.ReactNode }) {
  return <PrivyProvider appId="cmv85yqb1004b0fl1ig7an9b9" config={{ loginMethods: ['email'], appearance: { theme: 'light', accentColor: '#d53142', logo: '/logo.svg', showWalletLoginFirst: false }, embeddedWallets: { ethereum: { createOnLogin: 'off' } } }}>{children}</PrivyProvider>;
}
