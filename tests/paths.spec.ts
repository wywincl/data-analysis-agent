/**
 * resolvePluginFile: relative datasource paths anchor to the plugin package
 * root (machine-independent YAML), absolute / `:memory:` pass through.
 */
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { resolvePluginFile } from '../src/datasources/paths.ts'

/** The package root this checkout lives in (repo root = nearest package.json). */
const packageRoot = resolve(import.meta.dirname, '..')

describe('resolvePluginFile', () => {
  it('resolves a relative path against the plugin package root', () => {
    const resolved = resolvePluginFile('./demo/demo.db')
    expect(resolved).toBe(join(packageRoot, 'demo', 'demo.db'))
    expect(existsSync(resolved)).toBe(true)
  })

  it('resolves a bare filename against the package root too', () => {
    expect(resolvePluginFile('demo.db')).toBe(join(packageRoot, 'demo.db'))
  })

  it('passes absolute paths through untouched', () => {
    expect(resolvePluginFile('/tmp/demo.db')).toBe('/tmp/demo.db')
  })

  it('passes the :memory: sentinel through untouched', () => {
    expect(resolvePluginFile(':memory:')).toBe(':memory:')
  })
})
