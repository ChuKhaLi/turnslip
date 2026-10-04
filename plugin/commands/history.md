---
description: turnslip - list the recent turns of this project (Pro)
argument-hint: "[n] [--ids]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" history --session=${CLAUDE_SESSION_ID} $ARGUMENTS || echo "turnslip needs Node.js 18 or newer: install it from https://nodejs.org, then restart Claude Code."`

Show the output above to the user exactly as printed, then stop. Do not run any other command or change any file.
