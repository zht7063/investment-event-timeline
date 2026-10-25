import Link from "next/link";
import { beijingDay, JOB_LABEL } from "@/domain/research";
import { formatTime } from "@/domain/time";
import { listResearch } from "@/server/research/store";
import { ResearchForm } from "./ResearchForm";
import { RefreshHistory } from "./RefreshHistory";
export const dynamic = "force-dynamic";
export const metadata = { title: "股票区间研究 · 证据时间线" };
export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const history = listResearch(Number(params.page) || 1);
  const end = beijingDay(),
    start = beijingDay(new Date(Date.now() - 29 * 86400_000));
  return (
    <>
      <section className="hero hero-small">
        <h1>从一只股票，追到每条证据。</h1>
        <p className="lede">
          输入代码和披露日期范围，自动检索公告与新闻，整理事件、事实变化和冲突。
        </p>
      </section>
      <ResearchForm start={start} end={end} />
      <section id="research-history" aria-labelledby="history-heading">
        <div className="section-head">
          <h2 id="history-heading">研究记录 <span className="count">共 {history.total} 项</span></h2>
          <RefreshHistory />
        </div>
        <p className="hint">按创建时间排列，离开后可在这里继续查看。当前实例的研究任务共享可见。</p>
        {history.items.length ? <ul className="research-history">
          {history.items.map((job) => <li key={job.id}>
            <Link href={`/research/${job.id}`} prefetch={false}>
              <div className="history-title"><strong>{job.name || job.code}</strong>{job.name && <span className="history-code">{job.code}</span>}<span className="tag">{JOB_LABEL[job.status]}</span></div>
              <span className="history-range">披露日期 {job.start_day} 至 {job.end_day}</span>
              <span className="hint">任务更新 {formatTime(job.updated_at)} · 查看研究</span>
            </Link>
          </li>)}
        </ul> : <p className="empty">还没有研究记录。输入上方股票代码与日期，开始第一次研究。</p>}
        {history.pages > 1 && <nav className="research-actions" aria-label="研究记录分页">
          {history.page > 1 && <Link className="touch-link" href={`/research?page=${history.page - 1}#research-history`}>上一页</Link>}
          <span>第 {history.page} / {history.pages} 页</span>
          {history.page < history.pages && <Link className="touch-link" href={`/research?page=${history.page + 1}#research-history`}>下一页</Link>}
        </nav>}
      </section>
      <section>
        <h2>你会得到什么</h2>
        <p>
          资料陆续收录，分析逐步呈现。每个事件保留原文摘录和来源，未核实的关系单独标记。
        </p>
        <p className="hint">
          按北京时间的披露日期筛选。当前来源提供片段或摘要；覆盖范围和抓取失败会明确显示，不承诺全网信息完整。
        </p>
      </section>
    </>
  );
}
