const test = require('brittle')
const mem = require('..')

test('alloc', (t) => {
  const m = mem.alloc(32)

  t.is(m.byteLength, 32)
  t.is(m.state, 'noaccess')
  t.is(typeof m.locked, 'boolean')
  t.ok(m instanceof mem.SecureMemory)

  m.free()
})

test('alloc rejects invalid lengths', (t) => {
  t.exception.all(() => mem.alloc(-1), /non-negative integer/)
  t.exception.all(() => mem.alloc(1.5), /non-negative integer/)
  t.exception.all(() => mem.alloc('32'), /non-negative integer/)
})

test('memory starts zeroed', (t) => {
  const m = mem.alloc(64)

  t.alike(
    m.read((view) => Array.from(view)),
    new Array(64).fill(0)
  )

  m.free()
})

test('write then read', (t) => {
  const m = mem.alloc(4)

  m.write((view) => view.set([1, 2, 3, 4]))
  t.is(m.state, 'noaccess')

  t.alike(
    m.read((view) => Array.from(view)),
    [1, 2, 3, 4]
  )
  t.is(m.state, 'noaccess')

  m.free()
})

test('scopes expose their state and return the callback result', (t) => {
  const m = mem.alloc(4)

  t.is(
    m.read(() => m.state),
    'readonly'
  )
  t.is(
    m.write(() => m.state),
    'readwrite'
  )

  m.free()
})

test('nested scopes', (t) => {
  const m = mem.alloc(4)

  m.write((view) => {
    m.read(() => t.is(m.state, 'readwrite', 'read inside write keeps write access'))
    view[0] = 1
  })

  m.read(() => {
    m.write((view) => {
      view[0] = 2
    })
    t.is(m.state, 'readonly', 'leaving inner write restores read access')
  })

  t.is(m.state, 'noaccess')

  m.free()
})

test('scope restores access when the callback throws', (t) => {
  const m = mem.alloc(4)

  t.exception(() =>
    m.write(() => {
      throw new Error('boom')
    })
  )

  t.is(m.state, 'noaccess')

  m.free()
})

test('async scope stays open until the promise settles', async (t) => {
  const m = mem.alloc(4)

  const done = m.write(async (view) => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    view[0] = 7
    return 'ok'
  })

  t.is(m.state, 'readwrite')
  t.is(await done, 'ok')
  t.is(m.state, 'noaccess')

  t.is(
    m.read((view) => view[0]),
    7
  )

  await t.exception(m.read(() => Promise.reject(new Error('boom'))))
  t.is(m.state, 'noaccess')

  m.free()
})

test('interleaved async scopes', async (t) => {
  const m = mem.alloc(4)

  let release
  const reading = m.read(() => new Promise((resolve) => (release = resolve)))

  await m.write((view) => {
    view[0] = 1
    return Promise.resolve()
  })

  t.is(m.state, 'readonly', 'outstanding read keeps read access after write ends')

  release()
  await reading

  t.is(m.state, 'noaccess')

  m.free()
})

test('manual access', (t) => {
  const m = mem.alloc(4)

  m.readwrite()
  t.is(m.state, 'readwrite')
  m.view[0] = 9

  m.readonly()
  t.is(m.state, 'readonly')
  t.is(m.view[0], 9)

  m.read(() => {})
  t.is(m.state, 'readonly', 'a scope restores the manual state')

  m.noaccess()
  t.is(m.state, 'noaccess')

  m.free()
})

test('free', (t) => {
  const m = mem.alloc(4)
  const view = m.view

  m.free()

  t.is(m.state, 'freed')
  t.ok(m.freed)
  t.is(m.byteLength, 0)
  t.is(view.byteLength, 0, 'view is detached')
  t.is(view[0], undefined)

  m.free()

  t.exception(() => m.read(() => {}), /freed/)
  t.exception(() => m.write(() => {}), /freed/)
  t.exception(() => m.readonly(), /freed/)
})

test('free inside a scope', (t) => {
  const m = mem.alloc(4)

  m.write(() => m.free())

  t.is(m.state, 'freed')
})

test('zero length', (t) => {
  const m = mem.alloc(0)

  t.is(m.byteLength, 0)
  t.is(m.state, 'noaccess')
  t.is(
    m.read((view) => view.byteLength),
    0
  )

  m.free()
  t.is(m.state, 'freed')
})

test('inspecting and serialising never touches the memory', (t) => {
  const m = mem.alloc(4)

  const inspect = typeof Bare !== 'undefined' ? require('bare-inspect') : require('util').inspect

  t.is(inspect(m), "SecureMemory { byteLength: 4, state: 'noaccess', locked: " + m.locked + ' }')
  t.is(JSON.stringify(m), '{"byteLength":4,"state":"noaccess"}')

  m.free()
})
