'use client';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mail, Menu, Moon, Sun, X, LogOut } from 'lucide-react';
import { Brand } from './brand';
export function Header() {
  const { ready, authenticated, login, logout } = usePrivy();
  const [dark, setDark] = useState(false); const [menu, setMenu] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('meter.theme');
    const value = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = value ? 'dark' : 'light';
    const task = requestAnimationFrame(() => setDark(value));
    return () => cancelAnimationFrame(task);
  }, []);
  function theme() { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light'; localStorage.setItem('meter.theme', next ? 'dark' : 'light'); }
  return <header className="site-header"><div className="header-inner"><Brand /><nav className={menu ? 'nav open' : 'nav'} aria-label="Main navigation"><Link href="/#method" onClick={() => setMenu(false)}>The second look</Link><Link href="/#tariffs" onClick={() => setMenu(false)}>Tariff library</Link><Link href="/#reviews" onClick={() => setMenu(false)}>Your reviews</Link></nav><div className="header-actions"><button className="icon-button" onClick={theme} aria-label={dark ? 'Use light mode' : 'Use dark mode'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="button small quiet" disabled={!ready} onClick={() => authenticated ? logout() : login({ loginMethods: ['email'] })}>{authenticated ? <LogOut size={16} /> : <Mail size={16} />}<span>{authenticated ? 'Sign out' : 'Email sign in'}</span></button><button className="icon-button menu-button" onClick={() => setMenu(!menu)} aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu}>{menu ? <X /> : <Menu />}</button></div></div></header>;
}
