import { isPro } from './license.mjs'
import { turnslipHome } from './paths.mjs'
import { run } from './verbs.mjs'

// Run by the /turnslip:<verb> commands: node cli.mjs <verb> [--session=<id>] [args].
const [verb, ...args] = process.argv.slice(2)
const home = turnslipHome()
try {
  console.log(run({ verb, args, home, root: process.cwd(), pro: isPro(home) }))
} catch (e) {
  console.log(`turnslip · something went wrong: ${e?.message ?? e}`)
}
