---
description: turnslip - remove the Pro license from this machine and free one of its 3 machines
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" deactivate || echo "turnslip needs Node.js 18 or newer: install it from https://nodejs.org, then restart Claude Code."`

Show the output above to the user exactly as printed, then stop. Do not run any other command or change any file.
