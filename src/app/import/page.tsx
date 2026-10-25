import { listDocuments, listEventOptions, listSources } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { ImportFlow } from "./ImportFlow";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const db = ensureSeeded();
  return (
    <>
      <section className="hero hero-small">
        <p className="eyebrow">导入资料</p>
        <h1>粘贴一条资料，逐条核对论断。</h1>
        <p className="lede">
          系统只保存你提供的文本；链接仅作出处，服务器不会抓取。模型只给出论断与归并建议，引用校验、关联与结论由规则完成。
        </p>
      </section>
      <ImportFlow
        sources={listSources(db).map((s) => ({ id: s.id, name: s.name, tier: s.tier }))}
        documents={listDocuments(db)}
        events={listEventOptions(db)}
      />
    </>
  );
}
