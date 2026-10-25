import { notFound } from "next/navigation";
import { researchStatus } from "@/server/research/store";
import { ResearchClient } from "../ResearchClient";
export const dynamic = "force-dynamic";
export const metadata = { title: "研究进度与结果 · 证据时间线" };
export default async function ResearchDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    initial = researchStatus(id);
  if (!initial) notFound();
  return <ResearchClient initial={initial} />;
}
