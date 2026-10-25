import { STATUS_LABEL, type Status } from "@/domain/types";

/** Status is always shown as text; colour is a secondary cue. */
export function StatusBadge({ status }: { status: Status | null }) {
  return <span className={`badge badge-${status ?? "none"}`}>{status ? STATUS_LABEL[status] : "未计算"}</span>;
}
