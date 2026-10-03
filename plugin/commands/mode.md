---
description: turnslip - switch the slip between simple and detailed (detailed is Pro)
argument-hint: "simple | detailed"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" mode $ARGUMENTS || echo "turnslip needs Node.js 18 or newer: install it from https://nodejs.org, then restart Claude Code."`

Show the output above to the user exactly as printed, then stop. Do not run any other command or change any file.
