# turnslip

A slip after every Claude Code turn: what actually changed on disk (shell commands included), what
looks risky, and what Claude didn't mention. Take the whole turn back with `/turnslip:undo`.

    turnslip · Added a login page · 3 files · 🔑 key added in config.js · not mentioned: config.js · /turnslip:undo

Needs Claude Code 2.1.289 or newer and Node.js 18 or newer; `/turnslip:setup` checks both.
Site and Pro: https://turnslip.dev

## Commands

- `/turnslip:undo`: take back the last turn. Pro: `/turnslip:undo 3` or `/turnslip:undo <id>` for an earlier one.
- `/turnslip:history [n]` (Pro): the recent turns of this project, numbered for undo.
- `/turnslip:report` (Pro): a report of this session.
- `/turnslip:mode simple|detailed` (detailed is Pro), `/turnslip:setup`.
- `/turnslip:buy` opens the Pro checkout in your browser; `/turnslip:activate <key>` turns Pro on with your
  license key; `/turnslip:deactivate` frees the machine.

The core (the slip, the risk flags, undo of the last turn) is free. Pro is a one-time purchase with a
license key that works on up to 3 machines. Try history, undo of an earlier turn and the session report free, 3 runs in all, before you buy.

## Guides

- [How to undo Claude Code changes](https://turnslip.dev/guides/undo-claude-code-changes): what `/rewind` restores
  and misses, when git helps, and `/turnslip:undo`.
- [What did Claude Code just change?](https://turnslip.dev/guides/what-did-claude-code-change): tool calls, git,
  and the per-turn slip.

## What it runs

Hooks on SessionStart, UserPromptSubmit, PostToolUse, Stop, MessageDisplay and SessionEnd run
`node` scripts from this folder. They snapshot the project's files (what your `.gitignore` excludes is
left out), compare them at the end of each turn, and print the slip. A hook never blocks or continues
a turn, and exits quietly when Node is missing. The MessageDisplay hook hides the one-line receipt
turnslip asks Claude to end each reply with, unless Claude Code's verbose output is on (Claude Code then
shows replies unaltered); the slip shows its sentence instead.

## Network and data

turnslip never sends your files, your prompts or Claude's replies anywhere, and has no telemetry.
Everything it keeps (snapshots, slips, history, the license) stays in `~/.turnslip` on your machine,
which it keeps readable by you alone on macOS and Linux.

The only network calls are Pro's license checks, to Dodo Payments' public license endpoints, made by
plain HTTPS from Node:

- `https://live.dodopayments.com/licenses/activate` when you run `/turnslip:activate <key>`;
- `https://live.dodopayments.com/licenses/validate` from a background process about once a week while
  a license is active (never inside a hook, so a turn never waits for it);
- `https://live.dodopayments.com/licenses/deactivate` when you run `/turnslip:deactivate`.

Each sends your license key and, after activation, its activation id; activation also sends a machine
name of the form `turnslip · <platform> · <6 random hex>` (no host name, no user name). Without a
license, turnslip makes no network call at all. `/turnslip:buy` only asks your system to open the
checkout page in your browser; turnslip itself sends nothing.

## License

FSL-1.1-MIT: read it, change it, use it for yourself or your company; do not build a competing product
with it. Each version becomes MIT two years after its release. Source: https://github.com/ChuKhaLi/turnslip
