import { formatTime, parseTime } from "./time";
import { z } from "zod";

export const beijingDay = (date = new Date()) =>
  new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export const ResearchInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^\d{6}(\.(SH|SZ|BJ))?$/,
        "请输入六位股票代码，可带 .SH、.SZ 或 .BJ",
      ),
    start: z.string().refine(validDay, "请输入有效起始日期（YYYY-MM-DD）"),
    end: z.string().refine(validDay, "请输入有效截止日期（YYYY-MM-DD）"),
  })
  .superRefine((v, ctx) => {
    if (v.start > v.end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "截止日期不得早于起始日期",
      });
    if (v.end > beijingDay())
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "截止日期不得晚于今天",
      });
    if (Date.parse(v.end) - Date.parse(v.start) > 365 * 86400_000)
      ctx.addIssue({
        code: "custom",
        path: ["start"],
        message: "单次查询最多跨越 366 个自然日，可分段查询",
      });
  });
export type ResearchInput = z.infer<typeof ResearchInput>;
export type Instrument = { code: string; name: string };
export type Coverage =
  "pending" | "running" | "exhausted" | "limited" | "failed" | "unavailable";
export const COVERAGE_LABEL: Record<Coverage, string> = {
  pending: "待检索",
  running: "检索中",
  exhausted: "已遍历接口结果",
  limited: "覆盖受限",
  failed: "检索失败",
  unavailable: "未配置",
};
export type JobStatus =
  "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export const JOB_LABEL: Record<JobStatus, string> = {
  queued: "等待处理",
  running: "正在处理",
  completed: "处理完成",
  partial: "部分完成",
  failed: "处理失败",
  cancelled: "已取消",
};
export type SourceId = "ifind-notice" | "ifind-news" | "fuyao-news";
export const SOURCE_LABEL: Record<SourceId, string> = {
  "ifind-notice": "iFinD 公告",
  "ifind-news": "iFinD 新闻",
  "fuyao-news": "扶摇新闻",
};
export type Window = { start: string; end: string };
export type SourceState = {
  continuable?: boolean;
  allowance?: number;
  windows: Window[];
  cursor: string;
  seen: string[];
  requests: number;
  received: number;
  excluded: number;
  unknownDates: number;
  invalid: number;
  warnings: string[];
};
export type ResearchJob = {
  id: string;
  code: string;
  name: string | null;
  start_day: string;
  end_day: string;
  status: JobStatus;
  phase: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  lease_token: string | null;
  lease_until: string | null;
};
export type SourceRun = {
  job_id: string;
  source_id: SourceId;
  status: Coverage;
  state: string;
  error: string | null;
};

/** Keep source precision, including unknown/malformed dates, in all research views. */
export function formatDisclosure(value: string | null) {
  try {
    const parsed = parseTime(value);
    return parsed ? formatTime(parsed.iso, parsed.precision) : "未知";
  } catch {
    return "未知";
  }
}
