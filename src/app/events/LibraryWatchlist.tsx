'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
const KEY = 'watchlist:v1';
export function LibraryWatchlist() {
  const [watch, setWatch] = useState<string[] | null>(null), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [pending,startTransition] = useTransition();
  const router = useRouter(), params = useSearchParams();
  const watched = params.get('watched') === '1';
  const [selected, setSelected] = useState(watched);
  useEffect(() => setSelected(watched), [watched]);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); setWatch(Array.isArray(saved) ? saved.filter(v=> typeof v==='string').slice(0,50) : ['DEMO-A']); }
    catch { setWatch(['DEMO-A']); }
  }, []);
  const filter = (enabled: boolean, codes: string[]) => {
    setSelected(enabled);
    const p = new URLSearchParams(params);
    p.delete('offset'); p.delete('codes'); p.delete('watched');
    if (enabled) { p.set('watched','1'); if (codes.length) p.set('codes',codes.join(',')); }
    startTransition(()=>router.push(`/events?${p}`,{scroll:false}));
  };
  const save = (next: string[]) => {
    setWatch(next);
    try { localStorage.setItem(KEY,JSON.stringify(next)); setError(''); }
    catch { setError('浏览器未允许保存清单，当前页面仍可筛选。'); }
    if (watched) filter(true,next);
  };
  return <section className="watch" aria-label="关注清单" aria-busy={pending}>
    <div className="watch-head"><h2>关注清单</h2><label className="toggle"><input type="checkbox" checked={selected} disabled={!watch || pending} onChange={e=>filter(e.target.checked,watch ?? [])}/>只看关注标的</label></div>
    <ul className="chips">{watch?.map(code=><li key={code}><span>{code}</span><button type="button" disabled={pending} aria-label={`移除 ${code}`} onClick={()=>save(watch.filter(c=>c!==code))}>×</button></li>)}{watch?.length===0 && <li>清单为空</li>}</ul>
    <form className="watch-add" onSubmit={e=>{e.preventDefault();const code=draft.trim().toUpperCase();if(code && watch && !watch.includes(code) && watch.length<50)save([...watch,code]);setDraft('');}}>
      <label><span className="sr-only">添加标的代码</span><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="添加代码，如 002230.SZ" maxLength={32}/></label><button disabled={!watch || pending || watch.length>=50}>添加</button>
    </form><p className="hint">关注清单保存在本浏览器；筛选时用代码查询资料，不记录持仓。最多 50 个标的。</p>
    {pending && <p role="status">正在更新筛选…</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
