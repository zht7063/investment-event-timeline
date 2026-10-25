export const RELATION_STATE_LABEL: Record<string, string> = {
  pending: '等待核验', running: '核验中', done: '核验完成', failed: '核验失败',
};
export const ANALYSIS_STATE_LABEL: Record<string, string> = {
  pending: '等待分析', done: '已分析', failed: '分析失败', excluded: '日期不明',
};
export function safeLibraryReturn(value: unknown) {
  return typeof value === 'string' && (value === '/events' || value.startsWith('/events?')) ? value : '/events';
}
