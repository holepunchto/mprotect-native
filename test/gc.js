const test = require('brittle')
const { runtime } = require('which-runtime')
const mem = require('..')

const supported = runtime === 'node' && process.platform === 'linux'

test(
  'memory is released when unreachable, but not while a view is alive',
  { skip: !supported },
  async (t) => {
    const fs = require('fs')
    const v8 = require('v8')
    const vm = require('vm')

    v8.setFlagsFromString('--expose-gc')
    const gc = vm.runInNewContext('gc')

    const locked = () =>
      Number(fs.readFileSync('/proc/self/status', 'utf8').match(/VmLck:\s+(\d+)/)[1])

    const collect = async () => {
      for (let i = 0; i < 5; i++) {
        gc()
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }

    await collect()
    const before = locked()

    let all = []
    for (let i = 0; i < 100; i++) all.push(mem.alloc(4096))

    const allocated = locked() - before
    t.ok(allocated >= 400, 'allocations are locked')

    let view = all[0].view
    all = null

    await collect()
    const kept = locked() - before
    t.ok(kept > 0 && kept < allocated, 'only the allocation behind the kept view survives')

    view = null

    await collect()
    t.is(locked() - before, 0, 'everything is released')
  }
)
