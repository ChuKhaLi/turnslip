import { activateKey, deactivateKey, isPro } from './license.mjs'
import { logError } from './log.mjs'
import { turnslipHome } from './paths.mjs'
import { secureHome } from './store.mjs'
import { run } from './verbs.mjs'

// Run by the /turnslip:<verb> commands: node cli.mjs <verb> [--session=<id>] [args].
const [verb, ...args] = process.argv.slice(2)
const home = turnslipHome()
secureHome(home)
try {
  // The two license verbs talk to Dodo, so they are async; a key never holds a space, so several
  // arguments fail the key check.
  const out = verb === 'activate' ? await activateKey(home, args.join(' '))
    : verb === 'deactivate' ? await deactivateKey(home)
    : run({ verb, args, home, root: process.cwd(), pro: isPro(home) })
  console.log(out)
} catch (e) {
  logError(home, `cli ${verb}`, e, verb === 'activate' ? args.join(' ').trim() : undefined)
  console.log(`turnslip · something went wrong: ${e?.message ?? e}`)
}
