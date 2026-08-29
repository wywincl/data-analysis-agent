#!/bin/sh
# 启动 RD Data Analysis 实例(独立 DSH_HOME,与 ~/.dsh 日常实例完全隔离:
# 会话/工作区状态/插件组合互不可见;模型配置与凭据已迁移)。
#
#   scripts/serve.sh            # 前台启动,端口 3199
#   scripts/serve.sh --open     # 附加任意 dsh 参数
#
# 数据源配置:$DSH-RD profile 层 ~/.dsh-rd/profiles/rd/cordis.patch.yml
#
# 直接经 node 调用 dsh CLI(`dsh` pnpm script 即 node --import tsx/esm
# apps/cli/src/bin.ts),绕开 pnpm 对 packageManager 版本的严格校验导致的启动失败。
DSH_HOME="$HOME/.dsh-rd" exec node --import tsx/esm \
  "$HOME/Codes/Github/deepseek-harness/apps/cli/src/bin.ts" \
  --profile rd --port 3199 --no-open "$@"
