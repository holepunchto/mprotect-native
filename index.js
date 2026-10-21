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
  #writers = 0

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
    binding.free(this.#handle, this.#view.buffer)
  }

  #setBase(state) {
    this.#assertNotFreed()
    this.#base = state
    this.#update()
  }

  #scope(fn, write) {
    this.#assertNotFreed()

    if (write) this.#writers++
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
    if (write) this.#writers--
    else this.#readers--

    if (!this.freed) this.#update()
  }

  #update() {
    let state = this.#base

    if (this.#writers > 0) state = READWRITE
    else if (this.#readers > 0 && state === NOACCESS) state = READONLY

    binding.protect(this.#handle, state)
  }

  #assertNotFreed() {
    if (this.freed) throw new Error('Memory has been freed')
  }

  toJSON() {
    return { byteLength: this.byteLength, state: this.state }
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `SecureMemory { byteLength: ${this.byteLength}, state: '${this.state}', locked: ${this.locked} }`
  }
}

exports.SecureMemory = SecureMemory

exports.alloc = function alloc(byteLength) {
  return new SecureMemory(byteLength)
}
