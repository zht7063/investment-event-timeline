"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORY_LABEL, RELATION_LABEL, TIER_LABEL, type Category, type Relation } from "@/domain/types";

type Source = { id: string; name: string; tier: number };
type Doc = { id: string; title: string; source_name: string };
type EventOpt = { id: string; title: string; subject_code: string; event_type: string; matter_key: string };
type Claim = { id: string; quote: string; category: Category; content: string; linked: number };
type Preview = {
  versionId: string;
  status: "pending" | "done" | "failed";
  error: string | null;
  analysis: {
    event: { title: string; subjectCode: string | null; eventType: string; matterKey?: string | null } | null;
    rejected: { raw: unknown; reason: string }[];
    candidates: { eventId: string; title: string; score: number; autoLink: boolean; reasons: string[] }[];
  } | null;
  claims: Claim[];
};
type ApiError = { code: string; message: string; issues?: { path: string; message: string }[] };

const KINDS = [
  ["regulator", "监管/交易所"],
  ["issuer", "当事方公告"],
  ["media", "媒体原始报道"],
  ["research", "研报/评论"],
  ["rumor", "匿名传闻"],
] as const;
const MAX = 20_000;

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: ApiError; data?: T }> {
  try {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: j?.error ?? { code: `HTTP_${res.status}`, message: `请求失败（${res.status}）` }, data: j?.error?.preview };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "网络错误，请检查连接后重试" } };
  }
}

const errText = (e: ApiError) => `${e.message}${e.issues?.length ? `：${e.issues.map((i) => `${i.path || "请求"} ${i.message}`).join("；")}` : ""}（${e.code}）`;

export function ImportFlow({ sources, documents, events, initialDocId }: { sources: Source[]; documents: Doc[]; events: EventOpt[]; initialDocId?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"form" | "analyze" | "done">("form");
  const [doc, setDoc] = useState<{ documentId: string; decision: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sourceMode, setSourceMode] = useState<"existing" | "new">("existing");
  const [result, setResult] = useState<{ eventId: string; changed: boolean } | null>(null);
  const [subject, setSubject] = useState("");

  // BUG-1 fix: when navigating from sources page with ?doc=<id>, load that document directly
  useEffect(() => {
    if (!initialDocId) return;
    let live = true;
    (async () => {
      const p = await call<Preview>(`/api/documents/${encodeURIComponent(initialDocId)}/analyze`);
      if (!live) return;
      if (p.ok) {
        setDoc({ documentId: initialDocId, decision: "existing" });
        setPreview(p.data);
        setStep("analyze");
      } else {
        setError(`无法加载资料：${errText(p.error)}`);
      }
    })();
    return () => { live = false; };
  }, [initialDocId]);

  async function submit(form: FormData) {
    setError(null);
    const s = (k: string) => String(form.get(k) ?? "").trim();
    const payload = {
      source: sourceMode === "existing" ? { id: s("sourceId") } : { name: s("sourceName"), kind: s("sourceKind") },
      title: s("title"),
      body,
      url: s("url") || null,
      repostedFromId: s("repostedFromId") || null,
      publishedAt: s("publishedAt") || null,
      sourceUpdatedAt: s("sourceUpdatedAt") || null,
      subjectHint: subject.trim() || null,
    };
    setBusy("import");
    const r = await call<{ documentId: string; decision: string }>("/api/documents", { method: "POST", body: JSON.stringify(payload) });
    setBusy(null);
    if (!r.ok) return setError(errText(r.error));
    setDoc(r.data);
    setStep("analyze");
    const p = await call<Preview>(`/api/documents/${r.data.documentId}/analyze`);
    if (p.ok) setPreview(p.data);
    // Duplicates that were already analyzed don't need a model call.
    if (!(r.data.decision === "duplicate" && p.ok && p.data.status === "done")) await analyze(r.data.documentId);
  }

  async function analyze(documentId = doc!.documentId) {
    setError(null);
    setBusy("analyze");
    const qs = subject.trim() ? `?subject=${encodeURIComponent(subject.trim())}` : "";
    const r = await call<Preview>(`/api/documents/${documentId}/analyze${qs}`, { method: "POST" });
    setBusy(null);
    if (!r.ok) {
      if (r.data) setPreview(r.data);
      return setError(`分析失败：${errText(r.error)}。资料已保存为“待分析”，可重试或手动录入论断。`);
    }
    setPreview(r.data);
  }

  return (
    <div className="import">
      <ol className="steps" aria-label="步骤">
        <li aria-current={step === "form" ? "step" : undefined}>1 填写资料</li>
        <li aria-current={step === "analyze" ? "step" : undefined}>2 分析与归并</li>
        <li aria-current={step === "done" ? "step" : undefined}>3 完成</li>
      </ol>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {step === "form" && (
        <form
          className="panel form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
        >
          <fieldset>
            <legend>来源</legend>
            <div className="seg" role="radiogroup" aria-label="来源方式">
              <label>
                <input type="radio" name="sm" checked={sourceMode === "existing"} onChange={() => setSourceMode("existing")} /> 已有来源
              </label>
              <label>
                <input type="radio" name="sm" checked={sourceMode === "new"} onChange={() => setSourceMode("new")} /> 新来源
              </label>
            </div>
            {sourceMode === "existing" ? (
              <label>
                <span>来源</span>
                <select name="sourceId" required>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{TIER_LABEL[s.tier]}）
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="row">
                <label>
                  <span>来源名称</span>
                  <input name="sourceName" required maxLength={60} />
                </label>
                <label>
                  <span>来源类型（决定等级）</span>
                  <select name="sourceKind" required defaultValue="media">
                    {KINDS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <label>
              <span>转载自（可选，用于来源链）</span>
              <select name="repostedFromId" defaultValue="">
                <option value="">非转载 / 不确定</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}（{d.source_name}）
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>资料</legend>
            <div className="row">
              <label>
                <span>标题</span>
                <input name="title" required maxLength={200} />
              </label>
              <label>
                <span>主体标的代码（可选，正文未写代码时帮助归并）</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={32} placeholder="如 DEMO-A" />
              </label>
            </div>
            <label>
              <span>原文链接（可选，仅作出处，不抓取）</span>
              <input name="url" type="url" maxLength={500} placeholder="https://" />
            </label>
            <label>
              <span>
                正文（{body.length.toLocaleString()} / {MAX.toLocaleString()} 字）
              </span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={10} maxLength={MAX} aria-describedby="body-hint" />
            </label>
            <p id="body-hint" className="hint">
              正文按纯文本保存与显示，其中的指令不会被执行。
            </p>
          </fieldset>

          <fieldset>
            <legend>时间（北京时间，未知请留空）</legend>
            <div className="row">
              <label>
                <span>披露时间</span>
                <input name="publishedAt" placeholder="2026-03-05 或 2026-03-05 19:30" maxLength={40} />
              </label>
              <label>
                <span>来源更新时间</span>
                <input name="sourceUpdatedAt" placeholder="可留空" maxLength={40} />
              </label>
            </div>
            <p className="hint">抓取时间由系统记录；事件发生时间由论断抽取，缺失时显示“未知”。</p>
          </fieldset>

          <button type="submit" disabled={busy === "import" || !body.trim()}>
            {busy === "import" ? "保存中…" : "保存并分析"}
          </button>
        </form>
      )}

      {step === "analyze" && doc && (
        <AnalyzePanel
          decision={doc.decision}
          preview={preview}
          busy={busy}
          events={events}
          onRetry={() => analyze()}
          onManual={async (claim) => {
            setError(null);
            const r = await call<Preview>(`/api/documents/${doc.documentId}/claims`, { method: "POST", body: JSON.stringify({ claim }) });
            if (!r.ok) return errText(r.error);
            setPreview(r.data);
            return null;
          }}
          onAssociate={async (payload) => {
            setError(null);
            setBusy("associate");
            const r = await call<{ eventId: string; conclusionChanged: boolean }>("/api/associations", { method: "POST", body: JSON.stringify(payload) });
            setBusy(null);
            if (!r.ok) return setError(`关联失败：${errText(r.error)}`);
            setResult({ eventId: r.data.eventId, changed: r.data.conclusionChanged });
            setStep("done");
            router.refresh();
          }}
        />
      )}

      {step === "done" && result && (
        <div className="panel" role="status">
          <h2>已关联</h2>
          <p>{result.changed ? "事件结论已重算，并在结论历史中追加了一个版本。" : "事件的有效证据集合未变化，结论保持不变，未新增版本。"}</p>
          <p>
            <Link href={`/events/${result.eventId}`}>查看事件详情</Link> · <a href="/import">再导入一条</a>
          </p>
        </div>
      )}
    </div>
  );
}

type AssocPayload = {
  eventId?: string;
  newEvent?: { title: string; eventType: string; subjectCode: string; matterKey: string };
  links: { claimId: string; relation: Relation; targetClaimId?: string | null; reason: string }[];
};

function AnalyzePanel({
  decision,
  preview,
  busy,
  events,
  onRetry,
  onManual,
  onAssociate,
}: {
  decision: string;
  preview: Preview | null;
  busy: string | null;
  events: EventOpt[];
  onRetry: () => void;
  onManual: (claim: Record<string, string>) => Promise<string | null>;
  onAssociate: (p: AssocPayload) => void;
}) {
  const a = preview?.analysis;
  const auto = a?.candidates.find((c) => c.autoLink);
  const [target, setTarget] = useState<string>("");
  const chosen = target || auto?.eventId || "new";
  const [sel, setSel] = useState<Record<string, { on: boolean; relation: Relation; target: string; reason: string }>>({});
  const [targetClaims, setTargetClaims] = useState<{ eventId: string; claims: { claimId: string; content: string; sourceName: string }[] } | null>(null);
  const [manualErr, setManualErr] = useState<string | null>(null);

  const claims = preview?.claims ?? [];
  const get = (c: Claim) => sel[c.id] ?? { on: !c.linked, relation: "supports" as Relation, target: "", reason: "" };
  const set = (c: Claim, patch: Partial<ReturnType<typeof get>>) => setSel({ ...sel, [c.id]: { ...get(c), ...patch } });

  // Load the chosen event's claims so relations can name a target.
  useEffect(() => {
    if (chosen === "new") return;
    let live = true;
    fetch(`/api/events/${encodeURIComponent(chosen)}`)
      .then((r) => r.json())
      .then((d: { evidence?: { claimId: string; content: string; sourceName: string; revokedAt: string | null }[] }) => {
        const seen = new Set<string>();
        const list = (d.evidence ?? []).filter((e) => !e.revokedAt && !seen.has(e.claimId) && seen.add(e.claimId));
        if (live) setTargetClaims({ eventId: chosen, claims: list });
      })
      .catch(() => live && setTargetClaims({ eventId: chosen, claims: [] }));
    return () => {
      live = false;
    };
  }, [chosen]);

  const picked = claims.filter((c) => !c.linked && get(c).on);
  const invalid = picked.some((c) => !get(c).reason.trim() || (get(c).relation !== "supports" && !get(c).target));

  return (
    <div className="panel">
      <p className="meta">
        {decision === "existing" ? "正在处理已收录资料。" : decision === "duplicate" ? "内容与已收录版本相同，未新增记录。" : decision === "new_version" ? "同一来源链接的内容有变化，已保存为新版本。" : "已保存为新资料。"}
      </p>

      {busy === "analyze" && (
        <p role="status" className="loading">
          模型分析中，通常需要 10–60 秒…
        </p>
      )}
      {preview && preview.status !== "done" && busy !== "analyze" && (
        <div className="warn-box">
          <p>{preview.status === "failed" ? `状态：分析失败（${preview.error}）` : "状态：待分析"}</p>
          <button type="button" onClick={onRetry}>
            {preview.status === "pending" ? "开始分析" : "重试分析"}
          </button>
        </div>
      )}

      {a?.event && (
        <p className="meta">
          模型识别的事件特征：{a.event.title} · <code>{a.event.subjectCode ?? "未识别"}</code> · {a.event.eventType} · 事项标识 <code>{a.event.matterKey ?? "未确定"}</code>
        </p>
      )}

      <h2>论断（{claims.length}）</h2>
      {claims.length === 0 && busy !== "analyze" && <p className="empty">暂无通过校验的论断。可重试分析或在下方手动录入。</p>}
      <ul className="claims">
        {claims.map((c) => {
          const s = get(c);
          return (
            <li key={c.id} className={`claim cat-${c.category}`}>
              <label className="toggle">
                <input type="checkbox" checked={!c.linked && s.on} disabled={Boolean(c.linked)} onChange={(e) => set(c, { on: e.target.checked })} />
                <span className="cat">{CATEGORY_LABEL[c.category]}</span> {c.content}
                {c.linked ? <span className="tag">已关联</span> : null}
              </label>
              <blockquote>{c.quote}</blockquote>
              {!c.linked && s.on && (
                <div className="row">
                  <label>
                    <span>关系</span>
                    <select value={s.relation} onChange={(e) => set(c, { relation: e.target.value as Relation })}>
                      {(Object.keys(RELATION_LABEL) as Relation[]).map((r) => (
                        <option key={r} value={r}>
                          {RELATION_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>目标论断{s.relation === "supports" ? "（可选）" : "（必选）"}</span>
                    <select value={s.target} onChange={(e) => set(c, { target: e.target.value })} disabled={chosen === "new"}>
                      <option value="">{chosen === "new" ? "新事件无可选目标" : "直接关于事件"}</option>
                      {(targetClaims?.eventId === chosen ? targetClaims.claims : []).map((t) => (
                        <option key={t.claimId} value={t.claimId}>
                          {t.sourceName}：{t.content}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>理由</span>
                    <input value={s.reason} onChange={(e) => set(c, { reason: e.target.value })} maxLength={300} placeholder="为什么这样关联" />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {a && a.rejected.length > 0 && (
        <details className="rejected">
          <summary>{a.rejected.length} 条模型输出未通过校验，不进入结论</summary>
          <ul>
            {a.rejected.map((r, i) => (
              <li key={i}>
                {r.reason}：<code>{JSON.stringify(r.raw).slice(0, 200)}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="manual">
        <summary>手动录入论断</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const claim = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));
            const err = await onManual(claim);
            setManualErr(err);
            if (!err) e.currentTarget?.reset();
          }}
        >
          <label>
            <span>原文摘录（须逐字复制自正文）</span>
            <textarea name="quote" required rows={2} maxLength={500} />
          </label>
          <div className="row">
            <label>
              <span>类别</span>
              <select name="category">
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((k) => (
                  <option key={k} value={k}>
                    {CATEGORY_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>概括</span>
              <input name="content" required maxLength={300} />
            </label>
            <label>
              <span>发生时间（可选）</span>
              <input name="occurredAt" placeholder="2026-03-05" maxLength={40} />
            </label>
            <label>
              <span>有效期至（可选）</span>
              <input name="validUntil" placeholder="2026-06-30" maxLength={40} />
            </label>
          </div>
          <button type="submit">添加论断</button>
          {manualErr && <p className="error" role="alert">{manualErr}</p>}
        </form>
      </details>

      <h2>归并到事件</h2>
      <fieldset className="candidates">
        <legend className="sr-only">选择事件</legend>
        {a?.candidates.map((c) => (
          <label key={c.eventId} className="candidate">
            <input type="radio" name="target" checked={chosen === c.eventId} onChange={() => setTarget(c.eventId)} />
            <span>
              <strong>{c.title}</strong> {c.autoLink ? <span className="tag">事项标识一致</span> : <span className="tag">候选 {c.score}</span>}
              <span className="meta">{c.reasons.join("、")}</span>
            </span>
          </label>
        ))}
        <label className="candidate">
          <input type="radio" name="target" checked={chosen !== "new" && !a?.candidates.some((c) => c.eventId === chosen)} onChange={() => setTarget(events[0]?.id ?? "new")} />
          <span>
            其他已有事件：
            <select value={a?.candidates.some((c) => c.eventId === chosen) || chosen === "new" ? "" : chosen} onChange={(e) => setTarget(e.target.value || "new")}>
              <option value="">选择…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}（{e.subject_code}）
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="candidate">
          <input type="radio" name="target" checked={chosen === "new"} onChange={() => setTarget("new")} />
          <span>新建事件{a?.event ? `：${a.event.title}` : ""}</span>
        </label>
        <p className="hint">同一公司不足以合并；只有事项标识一致才默认选中。</p>
      </fieldset>

      {chosen === "new" && <NewEventFields key={JSON.stringify(a?.event)} seed={a?.event ?? null} id="new-event" />}

      <button
        type="button"
        disabled={!picked.length || invalid || busy === "associate"}
        onClick={() => {
          const links = picked.map((c) => ({ claimId: c.id, relation: get(c).relation, targetClaimId: get(c).target || null, reason: get(c).reason.trim() }));
          if (chosen === "new") {
            const f = document.getElementById("new-event") as HTMLFieldSetElement;
            const v = (n: string) => (f.querySelector(`[name=${n}]`) as HTMLInputElement).value.trim();
            onAssociate({ newEvent: { title: v("title"), eventType: v("eventType"), subjectCode: v("subjectCode"), matterKey: v("matterKey") }, links });
          } else onAssociate({ eventId: chosen, links });
        }}
      >
        {busy === "associate" ? "提交中…" : `确认关联 ${picked.length} 条论断并重算`}
      </button>
      {invalid && <p className="hint">每条选中的论断都需要理由；反驳、更正、替代需要选择目标论断。</p>}
    </div>
  );
}

function NewEventFields({ seed, id }: { seed: { title: string; subjectCode: string | null; eventType: string; matterKey?: string | null } | null; id: string }) {
  return (
    <fieldset id={id} className="row">
      <legend>新事件</legend>
      <label>
        <span>标题</span>
        <input name="title" defaultValue={seed?.title} required maxLength={100} />
      </label>
      <label>
        <span>主体标的代码</span>
        <input name="subjectCode" defaultValue={seed?.subjectCode ?? ""} required maxLength={32} />
      </label>
      <label>
        <span>事件类型</span>
        <input name="eventType" defaultValue={seed?.eventType ?? "other"} required maxLength={32} />
      </label>
      <label>
        <span>事项标识</span>
        <input name="matterKey" defaultValue={seed?.matterKey ?? ""} required maxLength={100} placeholder="如 acq:标的名称" />
      </label>
    </fieldset>
  );
}
