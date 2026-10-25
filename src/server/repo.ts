import { getDb } from "./db";

export type EventListItem = { id: string; title: string; subject_code: string; status: string | null };

export function listEvents(): EventListItem[] {
  return getDb()
    .prepare(
      `select e.id, e.title, e.subject_code, c.status
       from events e left join conclusions c on c.id = e.current_conclusion_id
       order by e.title`,
    )
    .all() as EventListItem[];
}
