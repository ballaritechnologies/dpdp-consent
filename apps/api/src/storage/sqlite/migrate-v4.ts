import type { SqliteRunner } from './migrate-v2'
import { V4_SQL_SQLITE } from '../seed-data'

/** v3 → v4: adds the entity_records table. Additive only; every statement is IF NOT EXISTS, so a
 * re-run after an interrupted upgrade is a no-op. */
export function migrateSqliteToV4(db: Pick<SqliteRunner, 'exec'>): void {
  db.exec(V4_SQL_SQLITE)
  db.exec('PRAGMA user_version = 4')
}
