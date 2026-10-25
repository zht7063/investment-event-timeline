import { libraryEventDetail } from '@/server/library';
import { handleError, fail } from '@/server/api';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = libraryEventDetail((await params).id, new URL(req.url).searchParams.get('job') || undefined);
    return result ? Response.json(result) : fail(404,'NOT_FOUND','事项或研究记录不存在');
  } catch (e) { return handleError(e); }
}
