/**
 * Ambient declarations for build-time virtual modules provided by
 * scripts/build.mjs (esbuild plugin): the echarts UMD bundle as raw text,
 * embedded verbatim into offline HTML exports.
 */

declare module 'echarts-umd-text' {
  const echartsUmd: string
  export default echartsUmd
}
