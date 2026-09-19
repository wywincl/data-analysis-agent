/**
 * Resolve a possibly-relative datasource file path against the plugin package
 * root, so config files (profile / patch YAML) can stay machine-independent:
 * `./demo/demo.db` means "the demo db shipped with this plugin" no matter
 * where the harness process happens to run. Absolute paths and `:memory:`
 * pass through untouched.
 *
 * The plugin ships as a single esbuild bundle (`lib/index.js`), so
 * `import.meta.url` points into `lib/` in production and into `src/` under
 * vitest — walk up to the nearest `package.json` to cover both layouts.
 *
 * @module dsh-data-analysis/datasources/paths
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolvePluginFile(file: string): string {
  if (isAbsolute(file) || file === ':memory:') return file
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6 && !existsSync(join(dir, 'package.json')); depth += 1) {
    dir = dirname(dir)
  }
  return resolve(dir, file)
}
