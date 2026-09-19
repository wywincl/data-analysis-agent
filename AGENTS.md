# AGENTS.md

This file provides context and instructions for AI coding agents working in this repository.

## Project Identity

- **Package**: `dsh-data-analysis-agent`
- **Description**: Data Analysis Agent plugin for DeepSeek Harness
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
- **Semantic layer**: YAML-based, hot-reloadable via `fs.watch` + debounce; config in `src/semantic/`. Lightweight analytical ontology (OBDA-style): `entities` (concepts, with `key` + named `relationships` + per-column enum `values`), `terms` (lexical layer), `metrics` (governed measures; entity/agg/measure, joins over relationships, ratio/expression). Entity and metric `extends` both resolve in `compose.ts` — scalars override, `filters`/`rowFilter` accumulate (AND), columns merge per field; `extends` never leaks downstream. Lint (`lint.ts`) emits `code`+`params`, wording lives in `i18n/host.ts`
- **Semantic workbench file**: the editor owns `<root>.workbench.yaml`; the host re-persists it (and re-adds its include) whenever the stored `semanticWorkbench` changes — never hand-edit that file while a server is running, and never silently drop authored fields when touching the editor
- **Approval**: `src/approval.ts` implements per-datasource `auto | ask` modes via `tools/pre-execute` waterfall
- **Datasource file paths**: relative sqlite/duckdb `file` paths resolve against the plugin package root (`src/datasources/paths.ts`), so profile/patch YAML stays machine-independent; never commit absolute local paths or inline credentials (`!!js process.env.*` instead)
- **Charts**: `src/charts/echarts-option.ts` builds complete ECharts options from intent (model never produces raw JSON)
- **Tests**: Vitest, co-located in `tests/`

## File Organization

```
src/
├── index.ts              # Plugin entry (host)
├── config.ts             # Plugin config schema
├── registry.ts           # DataSourceRegistry (schema/result caches)
├── jobs.ts               # Async query job store (bounded, TTL, audit sink)
├── audit.ts              # Query audit log + cost metering
├── approval.ts           # Per-datasource ask/auto gate (all SQL paths)
├── commands.ts           # /data-* slash commands
├── prompt.ts             # System prompt sections
├── events.ts             # Chart payload contract (tool/result.presentationMeta)
├── health.ts             # Datasource connectivity probe reporting
├── types.ts              # Shared host types (ColumnInfo, QueryResult, ...)
├── datasources/          # SQLite / MySQL / Postgres / ClickHouse / DuckDB / Spark (mock + Livy)
├── sql/
│   └── guard.ts          # SQL parser whitelist + LIMIT inject/clamp
├── semantic/             # Semantic layer: load/include/compose (inheritance), layer (SQL builder), tools, lint, drift, scaffold, serialize, summary
├── analysis/             # profile / topn / correlation / distribution / insight
├── charts/
│   ├── echarts-option.ts # Intent → ECharts option builder
│   └── server-render.ts  # Server-side SVG/PNG rendering
├── client/               # Browser half (React, ECharts, workbench card + workbench-ui shared primitives, export)
├── shared/
│   └── export-template.ts # Self-contained HTML + CSV template
├── tools/                # Tool definitions
└── i18n/                 # host + client zh/en strings
```

## Important Notes

- Do not add custom session event types — use `tool/result.presentationMeta`
- Do not bundle `@deepseek-ai/*` — they must resolve to the dsh checkout at runtime
- Client half changes require browser refresh (not hot-reloaded by `npm run watch`)
- Build artifacts (`lib/`) and `node_modules/` are gitignored
