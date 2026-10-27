import { cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Notice templates are editable data, not code: ship them next to the build so the server can
// read them at runtime (see src/services/breach-notice.ts).
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await cp(join(root, 'templates'), join(root, 'dist', 'templates'), { recursive: true })
console.log('[copy-templates] Copied templates/ to dist/templates/')
