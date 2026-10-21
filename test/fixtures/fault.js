const mem = require('../..')

const argv = typeof Bare !== 'undefined' ? Bare.argv : process.argv
const mode = argv[argv.length - 1]

const m = mem.alloc(32)

switch (mode) {
  case 'noaccess-read':
    m.view[0]
    break
  case 'readonly-write':
    m.readonly()
    m.view[0] = 1
    break
  case 'stashed-view':
    m.read((view) => view).subarray(0, 1)[0]
    break
}
