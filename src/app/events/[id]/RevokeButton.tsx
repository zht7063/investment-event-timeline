"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeButton({ evidenceId }: { evidenceId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <div className="revoke">
      <button
        type="button"
        className="ghost"
        disabled={state === "busy"}
        onClick={async () => {
          if (!confirm("撤销这条关联？记录会保留并标注撤销时间，结论随即重算。")) return;
          setState("busy");
          const res = await fetch(`/api/associations/${encodeURIComponent(evidenceId)}`, { method: "DELETE" }).catch(() => null);
          if (!res?.ok) {
            const j = await res?.json().catch(() => null);
            setMsg(j?.error?.message ?? "网络错误，撤销未完成");
            setState("error");
            return;
          }
          setState("idle");
          router.refresh();
        }}
      >
        {state === "busy" ? "撤销中…" : "撤销关联"}
      </button>
      {state === "error" && <p className="error" role="alert">{msg}</p>}
    </div>
  );
}
