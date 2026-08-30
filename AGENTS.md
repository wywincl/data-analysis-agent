# AGENTS.md

This file provides context and instructions for AI coding agents working in this repository.

## Project Identity

- **Package**: `dsh-data-agent`
- **Description**: Data Agent plugin for DeepSeek Harness
- **Runtime**: Node.js ESM (TypeScript)
- **Build**: esbuild (dual-half: Node ESM + client factory artifact)

## Architecture

This is a **dual-face plugin** for `deepseek-harness` (`dsh`):

- **Host half** (`src/` → `lib/index.js`): Data source registry, tools, SQL guard, approval, semantic layer, commands, prompt injection
- **Browser half** (`src/client/` → `lib/client.js`): Conversation node definition, ECharts SVG rendering, HTML/PNG/CSV export

Key design: `@deepseek-ai/*` packages are **always external** (symlinked via `scripts/link-dsh.mjs` to the local dsh checkout). The client half is a lazy-CJS factory artifact loaded by `window.__ModuleLoader__`.

## Commands

| Command | Purpose |
|---|---|
| `npm install && npm run setup:links` | Install deps + symlink `@deepseek-ai/*` to local dsh checkout |
| `npm run build` | Build both halves (esbuild) |
| `npm run watch` | Watch mode rebuild |
| `npm test` | Run Vitest suite |
| `npm run typecheck` | TypeScript type checking |
| `npm run demo:seed` | Seed the demo SQLite database |

## Conventions

- **No custom session events**: Chart payloads attach to `tool/result.presentationMeta` (catalog-known event type)
- **SQL guard**: `src/sql/guard.ts` enforces read-only whitelist (single SELECT/WITH only), LIMIT injection, identifier escaping
- **Semantic layer**: YAML-based, hot-reloadable via `fs.watch` + debounce; config in `src/semantic/`
- **Approval**: `src/approval.ts` implements per-datasource `auto | ask` modes via `tools/pre-execute` waterfall
- **Charts**: `src/charts/echarts-option.ts` builds complete ECharts options from intent (model never produces raw JSON)
- **Tests**: Vitest, co-located in `tests/`

## File Organization

```
src/
├── index.ts              # Plugin entry (host)
├── config.ts             # Plugin config schema
├── registry.ts           # DataSourceRegistry
├── datasources/          # SQLite / MySQL / Postgres / ClickHouse / Spark
├── sql/
│   └── guard.ts          # SQL parser whitelist + LIMIT injection
├── semantic/             # Semantic layer (load, types, layer, tools)
├── charts/
│   └── echarts-option.ts # Intent → ECharts option builder
├── client/               # Browser half (React, ECharts, export)
├── shared/
│   └── export-template.ts # Self-contained HTML + CSV template
├── tools/                # Tool definitions
├── commands.ts           # /data-* slash commands
├── prompt.ts             # System prompt sections
├── approval.ts           # Pre-execute approval waterfall
└── events.ts             # Event helpers
```

## Important Notes

- Do not add custom session event types — use `tool/result.presentationMeta`
- Do not bundle `@deepseek-ai/*` — they must resolve to the dsh checkout at runtime
- Client half changes require browser refresh (not hot-reloaded by `npm run watch`)
- Build artifacts (`lib/`) and `node_modules/` are gitignored
