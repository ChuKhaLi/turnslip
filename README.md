# turnslip

A slip after every Claude Code turn: what actually changed on disk (shell commands included), what
looks risky, and what Claude didn't mention. Take the whole turn back with `/turnslip:undo`.

    turnslip · Added a login page · 3 files · 🔑 key added in config.js · not mentioned: config.js · /turnslip:undo

## Install

    claude plugin marketplace add ChuKhaLi/turnslip
    claude plugin install turnslip@turnslip

Needs Claude Code 2.1.289 or newer and Node.js 18 or newer. `/turnslip:setup` checks Node. Site: https://turnslip.dev

## Commands

- `/turnslip:undo`: take back the last turn. Pro: `/turnslip:undo 3` or `/turnslip:undo <id>` for an earlier one.
- `/turnslip:history [n]` (Pro): the recent turns of this project, numbered for undo.
- `/turnslip:report` (Pro): a report of this session, as a claude.ai artifact where your plan has them.
- `/turnslip:mode simple|detailed` (detailed is Pro), `/turnslip:setup`.
- `/turnslip:buy` opens the Pro checkout in your browser; `/turnslip:activate <key>` turns Pro on with your
  license key; `/turnslip:deactivate` frees the seat.

## What it flags

🔑 keys added to a file your `.gitignore` doesn't exclude, or a new `.env` · 🗑 deleted files and recursive deletes ·
🗄 migrations and schema changes · 📦 dependency changes · 🚀 pushes, publishes and deploy config ·
⚠ writes outside the project (undo cannot restore those). Paths your `.gitignore` excludes are never
flagged, so a key in a gitignored `.env` is not reported.

## What it does not do

It never blocks Claude, never sends your code anywhere, and never claims a command succeeded or
failed. Undo restores files only; a database migration or a `git push` stays done, and the slip says so.

Data lives in `~/.turnslip/` (the last 50 turns per project).

## License

[FSL-1.1-MIT](LICENSE.md): read it, change it, use it for yourself or your company; do not build a
competing product with it. Each version becomes MIT two years after its release.

## About this repository

This is a mirror. turnslip is developed in a private repository and published here on each release,
so the history below is a history of releases rather than of every commit. Everything that runs on
your machine is here: the plugin (`plugin/`), its tests (`test/`), and the website (`site/`).

Comments in the code sometimes cite "spike §N" or a file under `docs/`. Those are internal notes and
measurements that are not published; the code and the tests stand on their own.

Run the tests with `npm test` (Node 18 or later, no dependencies).

Issues are welcome. Pull requests are read and, when accepted, applied by hand in the development
repository, so they reach this one with the next release.
