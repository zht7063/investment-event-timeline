import { z } from "zod";
import { libraryEvents, queryFromParams } from '@/server/library';
import { ensureSeeded } from '@/server/seed';
import { handleError, fail } from '@/server/api';
export const dynamic = 'force-dynamic';
export function GET(req: Request) {
  try { return Response.json(libraryEvents(queryFromParams(new URL(req.url).searchParams),ensureSeeded())); }
  catch (e) { return e instanceof z.ZodError ? fail(400,"VALIDATION_FAILED","筛选参数无效") : handleError(e); }
}
