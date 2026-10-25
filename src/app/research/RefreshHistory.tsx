"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshHistory() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="ghost"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "正在刷新" : "刷新记录"}
    </button>
  );
}
