#include <assert.h>
#include <bare.h>
#include <errno.h>
#include <js.h>
#include <mprotect.h>
#include <stdlib.h>
#include <string.h>

static const char *
mprotect_native__error_code(int err) {
  switch (-err) {
  case EINVAL:
    return "EINVAL";
  case ENOMEM:
    return "ENOMEM";
  case ENOSYS:
    return "ENOSYS";
  case EPERM:
    return "EPERM";
  case EACCES:
    return "EACCES";
  default:
    return "EIO";
  }
}

static void
mprotect_native__throw(js_env_t *env, int err) {
  js_throw_error(env, mprotect_native__error_code(err), strerror(-err));
}

static void
mprotect_native__on_finalize(js_env_t *env, void *data, void *finalize_hint) {
  mprotect_t *m = data;

  mprotect_free(m);

  free(m);
}

static mprotect_t *
mprotect_native__handle(js_env_t *env, js_value_t *value) {
  int err;

  void *data;
  err = js_get_value_external(env, value, &data);
  assert(err == 0);

  return data;
}

static js_value_t *
mprotect_native_alloc(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  int64_t len;
  err = js_get_value_int64(env, argv[0], &len);
  assert(err == 0);

  assert(len >= 0);

  mprotect_t *m = calloc(1, sizeof(mprotect_t));

  if (m == NULL) {
    mprotect_native__throw(env, -ENOMEM);

    return NULL;
  }

  err = mprotect_alloc(m, (size_t) len);

  if (err < 0) {
    free(m);

    mprotect_native__throw(env, err);

    return NULL;
  }

  // The memory is freed when the handle is collected, and JavaScript keeps the
  // handle reachable from the view's array buffer, so a live view can never
  // outlive the memory it points at.
  js_value_t *handle;
  err = js_create_external(env, m, mprotect_native__on_finalize, NULL, &handle);

  if (err < 0) {
    mprotect_free(m);
    free(m);

    return NULL;
  }

  js_value_t *arraybuffer;

  if (m->len == 0) {
    void *data;
    err = js_create_arraybuffer(env, 0, &data, &arraybuffer);
    assert(err == 0);
  } else {
    // Fails in runtimes that forbid external array buffers, such as Electron
    // with the V8 sandbox enabled. The pending exception propagates and the
    // handle finalizer releases the memory.
    err = js_create_external_arraybuffer(env, m->data, m->len, NULL, NULL, &arraybuffer);
    if (err < 0) return NULL;
  }

  js_value_t *result;
  err = js_create_array_with_length(env, 2, &result);
  assert(err == 0);

  err = js_set_element(env, result, 0, handle);
  assert(err == 0);

  err = js_set_element(env, result, 1, arraybuffer);
  assert(err == 0);

  return result;
}

static js_value_t *
mprotect_native_free(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  mprotect_t *m = mprotect_native__handle(env, argv[0]);

  mprotect_free(m);

  err = js_detach_arraybuffer(env, argv[1]);
  assert(err == 0);

  return NULL;
}

static js_value_t *
mprotect_native_protect(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  mprotect_t *m = mprotect_native__handle(env, argv[0]);

  uint32_t state;
  err = js_get_value_uint32(env, argv[1], &state);
  assert(err == 0);

  switch (state) {
  case MPROTECT_NOACCESS:
    err = mprotect_noaccess(m);
    break;
  case MPROTECT_READONLY:
    err = mprotect_readonly(m);
    break;
  case MPROTECT_READWRITE:
    err = mprotect_readwrite(m);
    break;
  default:
    err = -EINVAL;
  }

  if (err < 0) mprotect_native__throw(env, err);

  return NULL;
}

static js_value_t *
mprotect_native_state(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  mprotect_t *m = mprotect_native__handle(env, argv[0]);

  js_value_t *result;
  err = js_create_uint32(env, m->state, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
mprotect_native_locked(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  mprotect_t *m = mprotect_native__handle(env, argv[0]);

  js_value_t *result;
  err = js_get_boolean(env, m->locked, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
mprotect_native_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("alloc", mprotect_native_alloc)
  V("free", mprotect_native_free)
  V("protect", mprotect_native_protect)
  V("state", mprotect_native_state)
  V("locked", mprotect_native_locked)
#undef V

#define V(name, n) \
  { \
    js_value_t *val; \
    err = js_create_uint32(env, n, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("FREED", MPROTECT_FREED)
  V("NOACCESS", MPROTECT_NOACCESS)
  V("READONLY", MPROTECT_READONLY)
  V("READWRITE", MPROTECT_READWRITE)
#undef V

  return exports;
}

BARE_MODULE(mprotect_native, mprotect_native_exports)
