const { runtime } = require('which-runtime')

const fixture = require.resolve('../fixtures/fault.js')

exports.isWindows = (typeof Bare !== 'undefined' ? Bare.platform : process.platform) === 'win32'

// SIGSEGV, or SIGBUS which is 7 on Linux and 10 on Darwin
const FAULTS = ['SIGSEGV', 'SIGBUS', 11, 7, 10]

exports.faults = function faults(mode) {
  return FAULTS.includes(signal(mode))
}

function signal(mode) {
  if (runtime === 'bare') {
    const { spawnSync } = require('bare-subprocess')
    const os = require('bare-os')
    return spawnSync(os.execPath(), [fixture, mode]).signal
  }

  const { spawnSync } = require('child_process')
  return spawnSync(process.execPath, [fixture, mode]).signal
}
