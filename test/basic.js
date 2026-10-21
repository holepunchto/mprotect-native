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

test('reads share the memory', (t) => {
  const m = mem.alloc(4)

  m.write((view) => {
    view[0] = 1
  })

  t.is(
    m.read((a) => m.read((b) => a[0] + b[0])),
    2
  )
  t.is(m.state, 'noaccess')

  m.free()
})

test('a write is exclusive', (t) => {
  const m = mem.alloc(4)

  t.exception(() => m.read(() => m.write(() => {})), /held by a read/)
  t.exception(() => m.write(() => m.read(() => {})), /held by a write/)
  t.exception(() => m.write(() => m.write(() => {})), /held by a write/)
  t.is(m.state, 'noaccess', 'every scope was released')

  try {
    m.write(() => m.write(() => {}))
  } catch (err) {
    t.is(err.code, 'LOCKED')
  }

  m.write((view) => {
    view[0] = 1
  })
  t.is(
    m.read((view) => view[0]),
    1,
    'memory is usable again'
  )

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

test('async scopes hold the memory until they settle', async (t) => {
  const m = mem.alloc(4)

  let release
  const reading = m.read(() => new Promise((resolve) => (release = resolve)))

  t.is(
    m.read(() => m.state),
    'readonly',
    'another read can share'
  )
  t.exception(() => m.write(() => {}), /held by a read/)

  release()
  await reading

  const writing = m.write((view) => {
    view[0] = 1
    return new Promise((resolve) => (release = resolve))
  })

  t.exception(() => m.read(() => {}), /held by a write/)

  release()
  await writing

  t.is(
    m.read((view) => view[0]),
    1
  )
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

test('free and manual access are refused while a scope holds the memory', async (t) => {
  const m = mem.alloc(4)

  t.exception(() => m.write(() => m.free()), /held by a scope/)
  t.exception(() => m.read(() => m.readwrite()), /held by a scope/)

  let release
  const reading = m.read(() => new Promise((resolve) => (release = resolve)))

  t.exception(() => m.free(), /held by a scope/)
  t.is(m.state, 'readonly')

  release()
  await reading

  m.free()
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
