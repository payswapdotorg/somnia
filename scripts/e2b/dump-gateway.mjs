// dump-gateway.mjs — T16 recovery helper.
// If the gateway source is ever lost again (workspace recycle), this pulls
// gateway.mjs + gateway.env + supervisor.sh OUT of a still-running sandbox:
//
//   E2B_API_KEY=... node dump-gateway.mjs <sandboxId>
//
// Writes gateway.mjs next to this script; env/supervisor go to /tmp for
// inspection (they contain live secrets — never commit them).
import { Sandbox } from 'e2b'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sbx = await Sandbox.connect(process.argv[2], { apiKey: process.env.E2B_API_KEY })
console.log('connected:', sbx.sandboxId)

const code = await sbx.files.read('/home/z/my-project/scripts/e2b/gateway.mjs')
writeFileSync(join(HERE, 'gateway.mjs'), code)
console.log('gateway.mjs bytes:', Buffer.byteLength(String(code)))

const env = await sbx.files.read('/home/user/gateway.env')
writeFileSync('/tmp/gateway-live.env', env)
console.log('gateway.env -> /tmp/gateway-live.env (contains secrets)')

const sup = await sbx.files.read('/home/user/supervisor.sh')
writeFileSync('/tmp/supervisor-live.sh', sup)
console.log('supervisor.sh -> /tmp/supervisor-live.sh')
process.exit(0)
