import { listEvents } from "@/server/repo";

export const dynamic = "force-dynamic";

export default function Home() {
  const events = listEvents();
  return (
    <main>
      <h1>投资事件证据时间线</h1>
      {events.length === 0 ? (
        <p>暂无事件。</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              {e.title}：{e.status ?? "未计算"}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
