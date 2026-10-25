import { beijingDay } from "@/domain/research";
import { listResearch } from "@/server/research/store";
import { ResearchForm } from "./ResearchForm";
import { ResearchHistory } from "./ResearchHistory";
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
      <ResearchHistory key={history.page} history={{ ...history, items: history.items.map(job => ({ ...job })) }} />
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
