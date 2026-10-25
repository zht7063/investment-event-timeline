"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ResearchInput } from "@/domain/research";
export function ResearchForm({ start, end }: { start: string; end: string }) {
  const router = useRouter(),
    form = useRef<HTMLFormElement>(null),
    pending = useRef(false),
    key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dates, setDates] = useState({ start, end });
  return (
    <form
      ref={form}
      className="research-form"
      noValidate
      onChange={() => {
        key.current = null;
        setFields({});
        setError("");
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending.current) return;
        const data = Object.fromEntries(new FormData(e.currentTarget));
        const parsed = ResearchInput.safeParse(data);
        if (!parsed.success) {
          const errors: Record<string, string> = {};
          for (const issue of parsed.error.issues)
            errors[String(issue.path[0])] ??= issue.message;
          setFields(errors);
          (
            form.current?.elements.namedItem(
              Object.keys(errors)[0],
            ) as HTMLInputElement
          )?.focus();
          return;
        }
        pending.current = true;
        setBusy(true);
        setError("");
        key.current ??= Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          (value) => value.toString(16).padStart(2, "0"),
        ).join("");
        try {
          const response = await fetch("/api/research", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": key.current,
            },
            body: JSON.stringify(parsed.data),
            signal: AbortSignal.timeout(20_000),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error?.message || "创建任务失败");
          router.push(`/research/${result.id}`);
        } catch (e) {
          setError(
            e instanceof Error && e.name !== "TimeoutError"
              ? e.message
              : "连接中断，任务可能已经创建。再次点击将查询或恢复同一任务。",
          );
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <legend className="sr-only">查询条件</legend>
        <div className="research-field">
          <label htmlFor="research-code">股票代码</label>
          <input
            id="research-code"
            name="code"
            placeholder="例如 300308.SZ 或 600519"
            maxLength={9}
            aria-invalid={Boolean(fields.code)}
            aria-describedby="code-help code-error"
            autoComplete="off"
          />
          <span id="code-help" className="hint">
            支持沪、深、北交易所 A 股，系统会核对公司名称。
          </span>
          <span id="code-error" className="field-error">
            {fields.code}
          </span>
        </div>
        <div className="date-shortcuts" role="group" aria-label="快捷披露日期区间">
          {[30, 90, 180].map((days) => <button type="button" className="ghost" key={days} onClick={() => {
            setDates({ start: new Date(Date.parse(end) - (days - 1) * 86400_000).toISOString().slice(0, 10), end });
            key.current = null;
            setFields({});
            setError("");
          }}>近 {days} 日</button>)}
        </div>
        <p id="date-help" className="hint date-help">按披露日期筛选，最多 366 个自然日；时间均为北京时间。</p>
        <div className="research-dates">
          {(
            [
              ["start", "起始披露日期", start],
              ["end", "截止披露日期", end],
            ] as const
          ).map(([name, label]) => (
            <div key={name} className="research-field">
              <label htmlFor={`research-${name}`}>{label}</label>
              <input
                type="date"
                id={`research-${name}`}
                name={name}
                value={dates[name]}
                onChange={(e) => setDates((current) => ({ ...current, [name]: e.target.value }))}
                max={name === "start" ? dates.end || end : end}
                min={name === "end" ? dates.start || undefined : undefined}
                aria-invalid={Boolean(fields[name])}
                aria-describedby={`date-help ${name}-error`}
              />
              <span id={`${name}-error`} className="field-error">
                {fields[name]}
              </span>
            </div>
          ))}
        </div>
        <p className="hint">
          后台自动处理，离开页面不会中断任务。可从研究记录继续查看。
        </p>
        <button type="submit" aria-busy={busy} className="research-submit">
          {busy ? "正在创建…" : "开始研究"}
        </button>
      </fieldset>
      <p className="field-error" role={error ? "alert" : undefined}>
        {error}
      </p>
    </form>
  );
}
