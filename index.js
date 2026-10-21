const binding = require('./binding')

const { FREED, NOACCESS, READONLY, READWRITE } = binding

const STATES = {
  [FREED]: 'freed',
  [NOACCESS]: 'noaccess',
  [READONLY]: 'readonly',
  [READWRITE]: 'readwrite'
}

const kOwner = Symbol('owner')

class SecureMemory {
  #handle
  #view
  #byteLength
  #base = NOACCESS
  #readers = 0
  #writing = false

  constructor(byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new TypeError('byteLength must be a non-negative integer')
    }

    const [handle, arraybuffer] = binding.alloc(byteLength)

    // The handle owns the memory, so pin it to the array buffer. Any view, or
    // view of a view, then keeps the memory mapped for as long as it is alive.
    Object.defineProperty(arraybuffer, kOwner, { value: handle })

    this.#handle = handle
    this.#view = new Uint8Array(arraybuffer)
    this.#byteLength = byteLength
  }

  get byteLength() {
    return this.state === 'freed' ? 0 : this.#byteLength
  }

  get state() {
    return STATES[binding.state(this.#handle)]
  }

  get locked() {
    return binding.locked(this.#handle)
  }

  get freed() {
    return binding.state(this.#handle) === FREED
  }

  // Only accessible in the state the memory is in; touching it while
  // `noaccess` crashes the process.
  get view() {
    return this.#view
  }

  noaccess() {
    this.#setBase(NOACCESS)
  }

  readonly() {
    this.#setBase(READONLY)
  }

  readwrite() {
    this.#setBase(READWRITE)
  }

  read(fn) {
    return this.#scope(fn, false)
  }

  write(fn) {
    return this.#scope(fn, true)
  }

  free() {
    if (this.freed) return
    this.#assertNotHeld()
    binding.free(this.#handle, this.#view.buffer)
  }

  #setBase(state) {
    this.#assertNotFreed()
    this.#assertNotHeld()
    this.#base = state
    this.#update()
  }

  // Readers share the memory and a writer has it exclusively. Taking it never
  // waits: a conflicting scope throws, which also turns nesting into an error
  // rather than a deadlock.
  #scope(fn, write) {
    this.#assertNotFreed()

    if (this.#writing || (write && this.#readers > 0)) {
      throw locked('Memory is already held by ' + (this.#writing ? 'a write' : 'a read'))
    }

    if (write) this.#writing = true
    else this.#readers++

    let async = false

    try {
      this.#update()

      const result = fn(this.#view)

      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        async = true

        return result.then(
          (value) => {
            this.#exit(write)
            return value
          },
          (err) => {
            this.#exit(write)
            throw err
          }
        )
      }

      return result
    } finally {
      if (!async) this.#exit(write)
    }
  }

  #exit(write) {
    if (write) this.#writing = false
    else this.#readers--

    this.#update()
  }

  #update() {
    let state = this.#base

    if (this.#writing) state = READWRITE
    else if (this.#readers > 0 && state === NOACCESS) state = READONLY

    binding.protect(this.#handle, state)
  }

  #assertNotFreed() {
    if (this.freed) throw new Error('Memory has been freed')
  }

  #assertNotHeld() {
    if (this.#writing || this.#readers > 0) throw locked('Memory is held by a scope')
  }

  toJSON() {
    return { byteLength: this.byteLength, state: this.state }
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `SecureMemory { byteLength: ${this.byteLength}, state: '${this.state}', locked: ${this.locked} }`
  }
}

function locked(msg) {
  const err = new Error(msg)
  err.code = 'LOCKED'
  return err
}

exports.SecureMemory = SecureMemory

exports.alloc = function alloc(byteLength) {
  return new SecureMemory(byteLength)
}
