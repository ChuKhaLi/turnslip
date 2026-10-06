---
description: turnslip - check Node and show where turnslip keeps its data
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs":*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" setup || echo "turnslip needs Node.js 18 or newer: install it from https://nodejs.org, then restart Claude Code."`

Show the output above to the user exactly as printed, then stop. Do not run any other command or change any file.
