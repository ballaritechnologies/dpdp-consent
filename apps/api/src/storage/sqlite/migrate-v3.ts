import type { SqliteRunner } from './migrate-v2'

/** v2 → v3: adds the nullable `regime_json` column to tenant_settings. Additive only, no rows are
 * touched; the column check makes a re-run after an interrupted upgrade a no-op. */
export function migrateSqliteToV3(db: SqliteRunner): void {
  const cols = db.all('PRAGMA table_info(tenant_settings)').map(r => String(r['name']))
  if (!cols.includes('regime_json')) db.exec('ALTER TABLE tenant_settings ADD COLUMN regime_json TEXT')
  db.exec('PRAGMA user_version = 3')
}
