const test = require('brittle')
const { faults, isWindows } = require('./helpers')

test('reading noaccess memory faults', { skip: isWindows }, (t) => {
  t.ok(faults('noaccess-read'))
})

test('writing readonly memory faults', { skip: isWindows }, (t) => {
  t.ok(faults('readonly-write'))
})

test('a view kept past its scope faults', { skip: isWindows }, (t) => {
  t.ok(faults('stashed-view'))
})

test('fixture does not fault without an access', { skip: isWindows }, (t) => {
  t.absent(faults('none'))
})
