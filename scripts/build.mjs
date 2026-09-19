#!/usr/bin/env node
/**
 * Build both halves of the plugin with esbuild.
 *
 * Node half (`lib/index.js`): ESM, all npm dependencies (mysql2, pg,
 * node-sql-parser) bundled — the published package carries zero runtime
 * dependencies. `@deepseek-ai/*` stays EXTERNAL: cordis DI and the tools
 * registry are singletons owned by the harness; a second copy would break
 * service identity.
 *
 * Client half (`lib/client.js`): the loader's lazy-CJS factory artifact,
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 * with the platform module table (react, client runtime, slots, primitives)
 * as externals and echarts inlined, matching the in-repo tsdown clientBundle
 * preset output format (docs/cookbook/adding-a-settings-card.md, Packaging).
 *
 * `--watch` keeps esbuild alive: the node half rewrites lib/index.js on each
 * change; the client half re-wraps its (write:false) output into the factory
 * artifact through an onEnd plugin, because the wrapper must run after every
 * rebuild, not just the first.
 */
import { build } from 'esbuild'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const watch = process.argv.includes('--watch')

/**
 * Virtual module exposing the echarts UMD bundle as text, so the plugin can
 * emit self-contained offline HTML exports that embed `echarts.min.js`
 * verbatim. Kept as a virtual specifier so neither half pulls the whole
 * echarts API graph in where it is not needed.
 */
const echartsUmdText = {
  name: 'echarts-umd-text',
  setup(build) {
    build.onResolve({ filter: /^echarts-umd-text$/ }, (args) => ({ path: args.path, namespace: 'echarts-umd' }))
    build.onLoad({ filter: /.*/, namespace: 'echarts-umd' }, () => {
      const dist = require.resolve('echarts/package.json')
      const umdPath = resolve(dist, '..', 'dist', 'echarts.min.js')
      if (!existsSync(umdPath)) throw new Error(`echarts UMD build not found at ${umdPath}`)
      return { contents: readFileSync(umdPath, 'utf8'), loader: 'text' }
    })
  },
}

/** Node half. */
await build({
  entryPoints: ['src/index.ts'],
  outdir: 'lib',
  entryNames: 'index',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  plugins: [echartsUmdText],
  // Cordis DI and the tool registry are harness singletons — bundling a
  // second copy of any @deepseek-ai package breaks service identity.
  // (esbuild's external takes strings with * wildcards — the wildcard also
  // matches `/`, so deep imports like dsh-client-runtime/client are covered.)
  external: ['@deepseek-ai/*'],
  // Bundled CJS drivers (mysql2 auth plugins etc.) do runtime requires of
  // node builtins; ESM output has no `require`, so hand the bundle one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  ...(watch ? { watch: true } : {}),
})

/** Splice the factory wrapper around the CJS output: the loader provides only
 * `require`, so the artifact must open its own module/exports records. */
const factoryOpen =
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\n` +
  `var module = { exports: {} }; var exports = module.exports;\n`
const factoryClose = '\nreturn module.exports; } });'

/** Client half: lazy-CJS factory artifact per the client module system. */
await build({
  entryPoints: ['src/client/index.tsx'],
  outdir: 'lib',
  entryNames: 'client',
  bundle: true,
  minify: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  write: false,
  plugins: [
    echartsUmdText,
    {
      name: 'wrap-factory',
      setup(wrapped) {
        wrapped.onEnd((result) => {
          for (const file of result.outputFiles ?? []) {
            const text = file.path.endsWith('.js')
              ? factoryOpen + file.text + factoryClose
              : file.text
            writeFileSync(file.path, text, 'utf8')
          }
        })
      },
    },
  ],
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    // Platform packages resolve to the harness copies at load time; nothing
    // under this scope may ever be inlined into the client artifact either.
    '@deepseek-ai/*',
  ],
  supported: { 'top-level-await': false },
  ...(watch ? { watch: true } : {}),
})

console.log(watch
  ? 'watching: lib/index.js + lib/client.js rebuild on change (Ctrl+C to stop)'
  : 'build complete: lib/index.js (node), lib/client.js (client factory)')
