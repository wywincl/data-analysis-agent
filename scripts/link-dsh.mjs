#!/usr/bin/env node
/**
 * Dev-time dependency links for this out-of-tree dsh plugin.
 *
 * The plugin imports `@deepseek-ai/*` packages (cordis DI, tools, session,
 * commands, client runtime). Those MUST resolve to the same module instances
 * the harness itself loads — never a bundled copy — so we symlink the scope
 * into our local node_modules from a deepseek-harness source checkout.
 *
 * Usage:
 *   node scripts/link-dsh.mjs [path-to-deepseek-harness-checkout]
 *   DSH_CHECKOUT=/path/to/deepseek-harness npm run setup:links
 *
 * Without an argument or `DSH_CHECKOUT`, a few common checkout locations are
 * probed; if none exists the script fails with instructions instead of
 * guessing (no machine-specific paths live in this repository).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Package name → its directory inside the deepseek-harness checkout. */
const LINKS = {
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/schemastery': 'vendor/schemastery',
  '@deepseek-ai/dsh-tools': 'packages/core/tools',
  '@deepseek-ai/dsh-session': 'packages/core/session',
  '@deepseek-ai/dsh-commands': 'packages/interaction/commands',
  '@deepseek-ai/dsh-settings': 'packages/settings/settings',
  '@deepseek-ai/dsh-client-runtime': 'packages/client/runtime',
  '@deepseek-ai/dsh-client-ui-conversation': 'packages/client/ui-conversation',
  '@deepseek-ai/dsh-client-ui-slots': 'packages/client/ui-slots',
  '@deepseek-ai/dsh-client-ui-settings': 'packages/client/ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins': 'packages/client/ui-settings-plugins',
}

const home = homedir()
const candidates = [
  process.argv[2],
  process.env.DSH_CHECKOUT,
  join(home, 'Codes', 'Github', 'deepseek-harness'),
  join(home, 'deepseek-harness'),
  join(home, 'ZCodeProject', 'deepseek-harness'),
].filter(Boolean)

const checkout = candidates.map((p) => resolve(p)).find((p) => existsSync(join(p, 'package.json')))
if (checkout === undefined) {
  console.error('deepseek-harness checkout not found. Pass it explicitly, either:')
  console.error('  node scripts/link-dsh.mjs /path/to/deepseek-harness')
  console.error('  DSH_CHECKOUT=/path/to/deepseek-harness npm run setup:links')
  process.exit(1)
}

const scopeDir = join(process.cwd(), 'node_modules', '@deepseek-ai')
mkdirSync(scopeDir, { recursive: true })

let linked = 0
for (const [name, rel] of Object.entries(LINKS)) {
  const target = join(checkout, rel)
  if (!existsSync(join(target, 'package.json'))) {
    console.warn(`skip ${name}: missing ${target}`)
    continue
  }
  const linkPath = join(scopeDir, name.slice('@deepseek-ai/'.length))
  rmSync(linkPath, { force: true, recursive: true })
  symlinkSync(target, linkPath, 'dir')
  linked++
}
console.log(`linked ${linked} @deepseek-ai packages from ${checkout}`)
