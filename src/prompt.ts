/**
 * System-prompt section teaching the model the analysis workflow and the
 * guardrails (order 100–199 is the tool-guidance band).
 *
 * @module dsh-research/prompt
 */

import type { Config } from './config.ts'

export function workflowSectionText(config: Config): string {
  const sources = config.dataSources.map((ds) => `- ${ds.name} (${ds.type}${ds.sparkMock === true ? ', mock' : ''})`).join('\n') || '- (none configured)'
  const defaultNote = config.defaultDatasource !== ''
    ? `\nDefault datasource: **${config.defaultDatasource}** — when the user does not name a source, query "${config.defaultDatasource}".`
    : ''
  return `## Data analysis workflow

You are connected to these data sources through the rd-data-analysis plugin:
${sources}
${defaultNote}

Follow this discipline for every data question:
1. **list_data_sources** once when unsure what exists.
2. **inspect_schema** before writing SQL. Never guess table or column names.
3. **run_sql** with ONE read-only SELECT. Guardrails are non-negotiable and enforced for you:
   single SELECT/WITH statement, no DML/DDL, LIMIT injected when missing, per-source row cap and timeout.
   Always fill \`reason\` with the question the query answers (shown to approvers).
4. **render_chart** whenever a result has shape (trend → line, comparison → bar, share → pie,
   relationship → scatter, density → heatmap, single headline number → kpi). Prefer passing the
   \`resultId\` from run_sql over re-sending rows. Charts render inside the conversation with
   HTML/PNG/CSV export.
5. **analyze_data** for statistics: profile / topn / correlation / distribution — instead of hand-rolling
   the same SQL. Interpret the returned numbers in your answer.
6. Answer with the numbers you actually queried, cite the SQL you ran, and flag truncation
   (row caps) or mock datasources explicitly. If a query fails the guard, rewrite it as a
   single SELECT — do not attempt to bypass the guardrails.

Text2SQL quality rules: filter in SQL (not post-hoc), aggregate in SQL when possible, prefer
explicit column lists over *, and use the dialect of the target source (see inspect_schema output).`
}
