import Link from "next/link";
import { Status, STATUS_LABEL } from "@/domain/types";
import { formatTime } from "@/domain/time";
import { searchEvents } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { EventList } from "../EventList";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/events">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 50) : "";
  const parsedStatus = Status.safeParse(sp.status);
  const status = parsedStatus.success ? parsedStatus.data : undefined;
  const { items, total } = searchEvents({ text: q || undefined, status, limit: 100 }, ensureSeeded());
  const latest = items.reduce<string | null>((m, e) => (e.latest_fetched_at && (!m || e.latest_fetched_at > m) ? e.latest_fetched_at : m), null);

  return (
    <>
      <section className="hero">
        <h1>每个判断，都能追到原文。</h1>
        <p className="lede">
          这里保存演示事件与已确认归并的资料。自动研究结果独立保存在研究记录中。数据截至 {formatTime(latest)}（最新收录资料的抓取时间）。
        </p>
      </section>

      <form className="filters" role="search" method="get">
        <label>
          <span>搜索</span>
          <input name="q" defaultValue={q} placeholder="事件、公司或代码" maxLength={50} />
        </label>
        <label>
          <span>结论状态</span>
          <select name="status" defaultValue={status ?? ""}>
            <option value="">全部</option>
            {Status.options.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">筛选</button>
        {(q || status) && <Link href="/events">清除条件</Link>}
      </form>

      <p><Link href="/research">输入股票代码与日期，开始自动研究 →</Link></p>
      <EventList items={items} total={total} filtered={Boolean(q || status)} />
    </>
  );
}
