/**
 * Semantic layer file composition: `include` expansion.
 *
 * A semantic root file may pull in other files so a large catalog stays
 * reviewable — entities in one place, one file per business domain:
 *
 * ```yaml
 * include:
 *   - ./entities.yaml        # literal path
 *   - ./entities             # directory shorthand → *.yaml directly inside
 *   - ./domains/**\/*.yaml   # recursive glob
 * defaults:
 *   datasource: demo
 * ```
 *
 * Guarantees:
 * - **Zero dependencies.** The glob is a ~40-line matcher over `readdirSync`;
 *   adding a glob library for four patterns is not worth a supply-chain edge.
 * - **Post-order merge.** Included files are emitted BEFORE their includer, so
 *   the includer always wins on conflict (see compose.ts).
 * - **Cycle safe.** A file is visited at most once per load, so `a → b → a`
 *   terminates; first-seen position wins (include-guard semantics).
 * - **Loud on typos.** An `include` matching nothing fails the load rather than
 *   silently dropping half the catalog — a missing domain is a config bug, not
 *   an empty domain.
 *
 * @module dsh-rd-data-analysis/semantic/include
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { SemanticConfigError } from './errors.ts'

/** One YAML document in the include graph, still unvalidated. */
export interface LoadedFragment {
  /**
   * Originating file path, or an `<inline>` style label for string sources.
   * Used for error messages and (when it is a real path) file watching.
   */
  file: string
  /** Parsed YAML root. */
  doc: unknown
}

const YAML_EXT = /\.ya?ml$/i

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Sorted, dotfile-skipping, deterministic directory walk for YAML files. */
function listYamlFiles(dir: string, recursive: boolean): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (isDirectory(full)) {
      if (recursive) files.push(...listYamlFiles(full, true))
      continue
    }
    if (YAML_EXT.test(entry)) files.push(full)
  }
  return files
}

/** Escape one glob segment; `*` matches within a segment, `?` one character. */
function globToRegex(segment: string): RegExp {
  let out = ''
  for (const char of segment) {
    if (char === '*') out += '[^/]*'
    else if (char === '?') out += '[^/]'
    else out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** Match path segments against a glob; `**` spans directory boundaries. */
function matchSegments(segments: readonly string[], glob: readonly string[]): boolean {
  let index = 0
  for (let gi = 0; gi < glob.length; gi++) {
    const part = glob[gi]
    if (part === '**') {
      if (gi === glob.length - 1) return true
      for (let skip = index; skip <= segments.length; skip++) {
        if (matchSegments(segments.slice(skip), glob.slice(gi + 1))) return true
      }
      return false
    }
    if (index >= segments.length) return false
    if (!globToRegex(part).test(segments[index])) return false
    index++
  }
  return index === segments.length
}

/**
 * Expand one `include` entry against `baseDir` into concrete, existing files.
 * Supports literal paths, directory shorthand, and `*`/`**`/`?` globs.
 */
export function expandPattern(pattern: string, baseDir: string): string[] {
  const target = resolve(baseDir, pattern)
  if (isDirectory(target)) return listYamlFiles(target, false)

  const parts = target.split(sep).filter((part) => part !== '')
  const firstWild = parts.findIndex((part) => /[*?]/.test(part))
  if (firstWild === -1) return isFile(target) ? [target] : []

  const root = sep + parts.slice(0, firstWild).join(sep)
  if (!isDirectory(root)) return []
  const glob = parts.slice(firstWild)
  return listYamlFiles(root, true).filter((file) => matchSegments(file.slice(root.length + 1).split(sep), glob))
}

function readYamlFile(file: string): unknown {
  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (error) {
    throw new SemanticConfigError(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    return parseYaml(source)
  } catch (error) {
    throw new SemanticConfigError(`${file}: YAML parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function includeEntriesOf(doc: unknown, file: string): string[] {
  if (doc === null || typeof doc !== 'object') return []
  const raw = (doc as Record<string, unknown>).include
  if (raw === undefined || raw === null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new SemanticConfigError(`${file}: include[${index}] must be a non-empty path string, got ${JSON.stringify(entry)}`)
    }
    return entry
  })
}

/** Depth-first, post-order walk: dependencies first, the includer last. */
function pushFragment(file: string, doc: unknown, includeBase: string, seen: Set<string>, out: LoadedFragment[]): void {
  const key = file.startsWith('<') ? file : resolve(file)
  if (seen.has(key)) return
  seen.add(key)
  for (const pattern of includeEntriesOf(doc, file)) {
    const matches = expandPattern(pattern, includeBase)
    if (matches.length === 0) {
      throw new SemanticConfigError(`${file}: include "${pattern}" 未匹配到任何文件(相对目录 ${includeBase})`)
    }
    for (const match of matches) {
      if (seen.has(resolve(match))) continue
      pushFragment(match, readYamlFile(match), dirname(match), seen, out)
    }
  }
  out.push({ file, doc })
}

/** Load a root file and everything it includes, in merge order. */
export function loadFragments(rootFile: string): LoadedFragment[] {
  const out: LoadedFragment[] = []
  pushFragment(rootFile, readYamlFile(rootFile), dirname(rootFile), new Set(), out)
  return out
}

/**
 * Load an already-parsed root document, resolving its `include` entries
 * against `baseDir` (defaults to cwd). Used by `parseSemanticConfig`.
 */
export function loadInlineFragments(doc: unknown, baseDir: string | undefined, label = '<inline>'): LoadedFragment[] {
  const out: LoadedFragment[] = []
  pushFragment(label, doc, baseDir ?? process.cwd(), new Set(), out)
  return out
}

/** Real file paths behind a fragment list (inline labels dropped). */
export function realFiles(fragments: readonly LoadedFragment[]): string[] {
  return fragments.map((fragment) => fragment.file).filter((file) => !file.startsWith('<'))
}
