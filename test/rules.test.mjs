import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { evaluateRules, outsideTargets } from '../plugin/lib/rules.mjs'

// Not under tmpdir: writes into the temp directory are deliberately never flagged as "outside".
const root = join(homedir(), 'ts-rules-proj')
const ch = (path, status = 'modified', added = []) => ({ path, status, before: 'b', after: 'a', added })
const kinds = (changes, commands = []) => evaluateRules({ changes, commands, root }).map((f) => f.kind)

test('secret: a key-shaped added line fires with its line number', () => {
  const f = evaluateRules({ changes: [ch('app.js', 'modified', [{ no: 3, text: 'const k = "sk-test-1234567890abcdef"' }])], commands: [], root })
  assert.deepEqual(f, [{ kind: 'secret', path: 'app.js', line: 3 }])
})

test('secret: each known format fires', () => {
  for (const text of ['AKIAABCDEFGHIJKLMNOP', 'ghp_' + 'a'.repeat(36), 'sk_live_' + 'a'.repeat(16), '-----BEGIN RSA PRIVATE KEY-----', 'xoxb-1234567890-abc', 'github_pat_' + 'a'.repeat(40)]) {
    assert.deepEqual(kinds([ch('x.js', 'modified', [{ no: 1, text }])]), ['secret'], text)
  }
})

test('secret: short sk- strings, unchanged lines and .env templates do not fire', () => {
  assert.deepEqual(kinds([ch('x.js', 'modified', [{ no: 1, text: 'const task = "sk-1"' }])]), [])
  assert.deepEqual(kinds([ch('x.js', 'modified', [])]), [])
  assert.deepEqual(kinds([ch('.env.example', 'added', [{ no: 1, text: 'KEY=' }])]), [])
})

test('secret: a new .env fires even without a key-shaped value', () => {
  assert.deepEqual(evaluateRules({ changes: [ch('.env', 'added', [{ no: 1, text: 'DEBUG=1' }])], commands: [], root }), [{ kind: 'secret', path: '.env', line: null }])
})

test('delete: a deleted file or a recursive delete command fires; plain rm and soft reset do not', () => {
  assert.deepEqual(kinds([ch('a.txt', 'deleted')]), ['delete'])
  assert.deepEqual(kinds([], ['rm -rf dist']), ['delete'])
  assert.deepEqual(kinds([], ['git reset --hard HEAD~1']), ['delete'])
  assert.deepEqual(kinds([], ['rm notes.txt']), [])
  assert.deepEqual(kinds([], ['rm -f notes.txt']), [])
  assert.deepEqual(kinds([], ['rm -v a']), [])
  assert.deepEqual(kinds([], ['git reset --soft HEAD~1']), [])
})

test('database: migrations, prisma schema, sql and migrate commands fire; lookalikes do not', () => {
  assert.deepEqual(kinds([ch('prisma/migrations/1/migration.sql', 'added')]), ['database'])
  assert.deepEqual(kinds([ch('prisma/schema.prisma')]), ['database'])
  assert.deepEqual(kinds([], ['npx prisma migrate dev']), ['database'])
  assert.deepEqual(kinds([], ['psql -c "DROP TABLE users"']), ['database'])
  assert.deepEqual(kinds([], ['psql -c "TRUNCATE TABLE users"']), ['database'])
  assert.deepEqual(kinds([ch('src/migrationGuide.md')]), [])
  assert.deepEqual(kinds([], ['truncate -s 0 app.log']), [])
  assert.deepEqual(kinds([], ['echo "drop table" >> notes.md']), [])
})

test('packages: manifests, lockfiles and install commands fire; scripts and lookalikes do not', () => {
  assert.deepEqual(kinds([ch('package.json')]), ['packages'])
  assert.deepEqual(kinds([ch('requirements-dev.txt')]), ['packages'])
  assert.deepEqual(kinds([], ['npm install left-pad']), ['packages'])
  assert.deepEqual(kinds([], ['npm run build']), [])
  assert.deepEqual(kinds([ch('src/package.ts')]), [])
})

test('ship: CI and deploy config and push/publish commands fire; pull and status do not', () => {
  assert.deepEqual(kinds([ch('.github/workflows/ci.yml')]), ['ship'])
  assert.deepEqual(kinds([ch('Dockerfile')]), ['ship'])
  assert.deepEqual(kinds([], ['git push origin main']), ['ship'])
  assert.deepEqual(kinds([], ['vercel deploy --prod']), ['ship'])
  assert.deepEqual(kinds([], ['git pull', 'git status']), [])
})

test('outside: writes above the root fire; in-project, /dev/null, temp and after-cd do not', () => {
  assert.deepEqual(outsideTargets('echo x > ../other/file', root), ['../other/file'])
  assert.equal(outsideTargets('cp a.txt /etc/hosts', root).length, 1)
  assert.deepEqual(outsideTargets('echo x > out.txt', root), [])
  assert.deepEqual(outsideTargets('npm test 2>/dev/null', root), [])
  assert.deepEqual(outsideTargets('npm test 2>&1', root), [])
  assert.deepEqual(outsideTargets(`echo x > ${join(tmpdir(), 'scratch.txt')}`, root), [])
  assert.deepEqual(outsideTargets('cd sub && echo x > ../../out', root), [])
})

test('secret: sk- inside a hyphenated or word identifier does not fire; a standalone key still does (NEXT §7)', () => {
  const line = (text) => kinds([ch('x.js', 'modified', [{ no: 1, text }])])
  assert.deepEqual(line('const id = "task-sk-abcdefghijklmnopqrstuvwxyz"'), [])
  assert.deepEqual(line('const desk_sk-abcdefghijklmnopqrstuvwxyz = 1'), [])
  assert.deepEqual(line('const k = mask-sk-proj-abcdefghijklmnopqrstuvwxyz'), [])
  assert.deepEqual(line('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz'), ['secret'])
  assert.deepEqual(line('key: sk-ant-abcdefghijklmnopqrstuvwxyz'), ['secret'])
  assert.deepEqual(line('sk-abcdefghijklmnopqrstuvwxyz'), ['secret']) // at the start of the line
})

// A commit message or a note that names a command is text, not that command (a 📦 seen live, 2026-10-04).
test('commands quoted as text do not fire: messages, echo, heredoc and here-string bodies', () => {
  assert.deepEqual(kinds([], ['git commit -q -m "fix: item 4 ran npm install with PowerShell"']), [])
  assert.deepEqual(kinds([], ["git commit -m 'docs: git push and rm -rf dist explained'"]), [])
  assert.deepEqual(kinds([], ['gh pr create --title "npm publish flow" --body "run git push then npm publish"']), [])
  assert.deepEqual(kinds([], ['echo "npm install left-pad" >> notes.md', "printf 'git push\\n' > todo.txt"]), [])
  assert.deepEqual(kinds([], ["git commit -q -F - <<'EOF'\nfix: npm install, git push, rm -rf dist\nEOF"]), [])
  assert.deepEqual(kinds([], ["cat > notes.md <<EOF\nDROP TABLE users\nEOF"]), [])
  assert.deepEqual(kinds([], ["git commit -m @'\nnpm install and git push\n'@"]), [])
})

test('commands still fire around quoted text and when a heredoc feeds a shell', () => {
  assert.deepEqual(kinds([], ['git commit -m "release" && git push origin main']), ['ship'])
  assert.deepEqual(kinds([], ['echo y | npm install left-pad']), ['packages'])
  assert.deepEqual(kinds([], ["bash <<'EOF'\nnpm install left-pad\nEOF"]), ['packages'])
  assert.deepEqual(kinds([], ["ssh host <<EOF\nrm -rf build\nEOF"]), ['delete'])
  assert.deepEqual(kinds([], ['bash -c "npm install left-pad"']), ['packages'])
  assert.deepEqual(kinds([], ['psql -c "DROP TABLE users"']), ['database'])
})

// Blanking text must never hide what runs: a heredoc fed to a database client or an interpreter, or a
// command substitution inside a quoted message (security review, 2026-10-04).
test('heredocs fed to anything but cat, tee, git or gh, and quoted substitutions, still fire', () => {
  assert.deepEqual(kinds([], ["psql mydb <<'SQL'\nDROP TABLE users;\nSQL"]), ['database'])
  assert.deepEqual(kinds([], ["sudo bash <<EOF\nnpm install left-pad\nEOF"]), ['packages'])
  assert.deepEqual(kinds([], ["python - <<EOF\nimport os; os.system('git push')\nEOF"]), ['ship'])
  assert.deepEqual(kinds([], ["cat <<EOF > notes.md\n$(npm install left-pad)\nEOF"]), ['packages'])
  assert.deepEqual(kinds([], ['git commit -m "release $(git push origin main)"']), ['ship'])
  assert.deepEqual(kinds([], ['echo "`npm install left-pad`" > out.txt']), ['packages'])
  assert.deepEqual(kinds([], ["cat <<'EOF' > notes.md\n$(npm install left-pad)\nEOF"]), [])
})

test('text piped on to another program still fires', () => {
  assert.deepEqual(kinds([], ["cat <<EOF | bash\nnpm install left-pad\nEOF"]), ['packages'])
  assert.deepEqual(kinds([], ['echo "npm install left-pad" | sh']), ['packages'])
  assert.deepEqual(kinds([], ["printf 'git push' | bash"]), ['ship'])
  assert.deepEqual(kinds([], ['echo "npm install left-pad" || true']), [])
})
