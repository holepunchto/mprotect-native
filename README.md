# mprotect-native

Guarded, access controlled memory for secrets, for Bare and Node.js. Built on [libmprotect](https://github.com/holepunchto/libmprotect).

```
npm i mprotect-native
```

Memory is allocated between guard pages, locked out of swap and core dumps where the platform allows it, zeroed on free, and inaccessible unless explicitly opened. Touching it while inaccessible crashes the process, by design.

## Usage

```js
const mem = require('mprotect-native')

const key = mem.alloc(32)

key.write((view) => view.set(secret))

key.read((view) => sodium.crypto_sign_detached(signature, message, view))

key.free()
```

## API

#### `const m = mem.alloc(byteLength)`

Allocate `byteLength` bytes of zeroed memory in the `noaccess` state. Also available as `new mem.SecureMemory(byteLength)`.

#### `const result = m.read(fn)`

Call `fn(view)` with the memory readable and return its result. If `fn` returns a promise, the memory stays readable until it settles and a promise is returned.

#### `const result = m.write(fn)`

Like `m.read()`, but with the memory readable and writable.

Scopes work like a semaphore that never waits. Any number of `read()` scopes may hold the memory at once, while a `write()` scope holds it exclusively. Opening a scope that conflicts with one already held throws an error with `code: 'LOCKED'`, so a write inside a read, or a read or write inside a write, is an error rather than a deadlock. Once every scope has closed, the memory returns to its previous state.

An async scope holds the memory until its promise settles, which is what lets work such as `crypto_pwhash_async()` read it from another thread:

```js
await password.read((view) => sodium.crypto_pwhash_async(hash, view, salt, ops, mem, alg))
```

#### `m.noaccess()`, `m.readonly()`, `m.readwrite()`

Set the access outside of any scope, for when access must span code that cannot be wrapped in a callback. Access is then through `m.view`. Throws with `code: 'LOCKED'` while a scope holds the memory.

#### `m.view`

A `Uint8Array` over the memory. It is only accessible while the memory is readable, so only use it inside a scope or after `m.readonly()` or `m.readwrite()`, and do not log or inspect it while inaccessible. A view, or any view derived from it, keeps the memory allocated for as long as it is reachable.

#### `m.free()`

Zero and release the memory. Every view is detached and has length 0 afterwards. Calling it again does nothing. Throws with `code: 'LOCKED'` while a scope holds the memory, as that scope may still be using it. Memory that becomes unreachable is also freed on garbage collection, but freeing explicitly releases the secret straight away.

#### `m.byteLength`

The length of the memory, or 0 once freed.

#### `m.state`

One of `'noaccess'`, `'readonly'`, `'readwrite'` or `'freed'`.

#### `m.locked`

Whether the memory could be locked out of swap. It is `false` when, for example, `RLIMIT_MEMLOCK` is exhausted; the memory is then still guarded and access controlled, but may be swapped to disk.

#### `m.freed`

Whether the memory has been freed.

Inspecting or serialising `m` itself is safe and never touches the memory.

## Caveats

External array buffers are required, so the module does not work in runtimes that forbid them, such as Electron with the V8 sandbox enabled.

## License

Apache-2.0

