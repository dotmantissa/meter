'use client';
import {useEffect,useState} from 'react';
import {ArrowUp} from 'lucide-react';

export function BackToTop() {
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  const update=()=>setVisible(window.scrollY>480);
  const initial=requestAnimationFrame(update);
  window.addEventListener('scroll',update,{passive:true});
  return ()=>{cancelAnimationFrame(initial);window.removeEventListener('scroll',update);};
 },[]);
 if(!visible)return null;
 function returnToTop(){
  document.getElementById('main-content')?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 }
 return <button type="button" className="back-to-top" aria-label="Back to top" title="Back to top" onClick={returnToTop}><ArrowUp size={22} aria-hidden="true"/></button>;
}
