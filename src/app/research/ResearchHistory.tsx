'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { JOB_LABEL } from '@/domain/research';
import { formatTime } from '@/domain/time';
import type { listResearch } from '@/server/research/store';

type History = ReturnType<typeof listResearch>;
export function ResearchHistory({ history }: { history: History }) {
  const router = useRouter(), pathname = usePathname();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const firstCheckbox = useRef<HTMLInputElement>(null);
  const chosen = selected.filter(id => history.items.some(job => job.id === id));
  const busy = deleting || refreshing;
  const refresh = () => startTransition(() => router.refresh());

  async function clear() {
    if (busy) return;
    setError(''); setMessage('');
    if (!selecting) {
      setSelecting(true); setSelected([]);
      requestAnimationFrame(() => firstCheckbox.current?.focus());
      return;
    }
    if (!chosen.length) { setSelecting(false); setSelected([]); return; }
    setDeleting(true);
    try {
      const response = await fetch('/api/research', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: chosen }), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error();
      await response.json();
      setSelecting(false); setSelected([]);
      setMessage(`已移除 ${chosen.length} 条研究记录及其专属事件和资料。`);
      refresh(); button.current?.focus();
    } catch {
      setError('删除结果尚未确认，已保留选择。可刷新核对，或点击删除重试。');
    } finally { setDeleting(false); }
  }

  return <section id="research-history" aria-labelledby="history-heading" aria-busy={busy}>
    <div className="section-head">
      <h2 id="history-heading">研究记录 <span className="count">共 {history.total} 项</span></h2>
      <div className="research-actions">
        <button type="button" className="ghost" disabled={busy} onClick={refresh}>{refreshing ? '正在刷新' : '刷新记录'}</button>
        <button ref={button} type="button" className="ghost" disabled={busy || (!selecting && !history.items.length)} onClick={() => void clear()} aria-describedby={selecting ? 'history-delete-help' : undefined}>
          {deleting ? '正在删除' : !selecting ? '清除' : chosen.length ? '删除' : '取消'}
        </button>
      </div>
    </div>
    <p className="hint">按创建时间排列，离开后可在这里继续查看。当前实例的研究任务共享可见。</p>
    {selecting && <p id="history-delete-help" className="hint">已选择 {chosen.length} 项。选择本页记录后点击删除；正在处理的任务会停止，专属事件和资料一并移除，其他研究共享的内容保留。切换页码将取消选择。</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {history.items.length ? <ul className="research-history">
      {history.items.map((job, index) => <li key={job.id} className={selecting ? 'history-selectable' : undefined}>
        {selecting && <label className="history-select-control">
          <input ref={index === 0 ? firstCheckbox : undefined} type="checkbox" disabled={busy} checked={chosen.includes(job.id)}
            onChange={e => setSelected(e.target.checked ? [...chosen,job.id] : chosen.filter(id=>id!==job.id))}/>
          <span className="sr-only">选择 {job.name || job.code} {job.start_day} 至 {job.end_day}（{job.id.slice(0,8)}）</span>
        </label>}
        <Link href={`/research/${job.id}`} prefetch={false}>
          <div className="history-title"><strong>{job.name || job.code}</strong>{job.name && <span className="history-code">{job.code}</span>}<span className="tag">{JOB_LABEL[job.status]}</span></div>
          <span className="history-range">披露日期 {job.start_day} 至 {job.end_day}</span>
          <span className="hint">任务更新 {formatTime(job.updated_at)} · 查看研究</span>
        </Link>
      </li>)}
    </ul> : <p className="empty">还没有研究记录。输入上方股票代码与日期，开始第一次研究。</p>}
    {history.pages > 1 && <nav className="research-actions" aria-label="研究记录分页">
      {history.page > 1 && !busy && <Link className="touch-link" href={`${pathname}?page=${history.page - 1}#research-history`}>上一页</Link>}
      <span>第 {history.page} / {history.pages} 页</span>
      {history.page < history.pages && !busy && <Link className="touch-link" href={`${pathname}?page=${history.page + 1}#research-history`}>下一页</Link>}
    </nav>}
  </section>;
}
