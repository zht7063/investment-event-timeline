import { listEvents } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { STATUS_LABEL } from "@/domain/types";

export const dynamic = "force-dynamic";

export default function Home() {
  const events = listEvents(ensureSeeded());
  return (
    <main>
      <h1>投资事件证据时间线</h1>
      {events.length === 0 ? (
        <p>暂无事件。</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              {e.title}：{e.status ? STATUS_LABEL[e.status] : "未计算"}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
