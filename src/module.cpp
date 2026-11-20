// The test module. Every worker of the page loads one copy of it. It is built
// twice (Makefile): with relaxed SIMD and with plain SIMD128 only. Each
// function exercises one wasm feature the way compiled numerical code does,
// and returns something the page can check.
#include <wasm_simd128.h>

#include <atomic>
#include <csetjmp>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

#define EXPORT extern "C" __attribute__((used, visibility("default")))

// a*b + c on two doubles. With relaxed SIMD this is one fused instruction
// (f64x2.relaxed_madd); without it, a multiply and an add.
#ifdef __wasm_relaxed_simd__
static inline v128_t madd(v128_t a, v128_t b, v128_t c) {
  return __builtin_wasm_relaxed_madd_f64x2(a, b, c);
}
static inline v128_t nmadd(v128_t a, v128_t b, v128_t c) {
  return __builtin_wasm_relaxed_nmadd_f64x2(a, b, c);
}
#else
static inline v128_t madd(v128_t a, v128_t b, v128_t c) {
  return wasm_f64x2_add(wasm_f64x2_mul(a, b), c);
}
static inline v128_t nmadd(v128_t a, v128_t b, v128_t c) {
  return wasm_f64x2_sub(c, wasm_f64x2_mul(a, b));
}
#endif

// 16-byte aligned doubles. aligned_alloc wants a size that is a multiple of
// the alignment, and returns NULL otherwise.
static double *alloc_doubles(size_t n) {
  double *p = (double *)aligned_alloc(16, (n * sizeof(double) + 15) & ~(size_t)15);
  if (!p) abort();
  return p;
}

EXPORT int relaxed_build(void) {
#ifdef __wasm_relaxed_simd__
  return 1;
#else
  return 0;
#endif
}

// y = a*x + y, then y = y - b*x, two doubles at a time. Returns the sum of y.
EXPORT double axpy(int n) {
  double *x = alloc_doubles(n);
  double *y = alloc_doubles(n);
  for (int i = 0; i < n; i++) {
    x[i] = (i % 7) * 0.5;
    y[i] = (i % 5) * 0.25;
  }
  v128_t a = wasm_f64x2_splat(3.0), b = wasm_f64x2_splat(1.0);
  for (int i = 0; i + 1 < n; i += 2) {
    v128_t xv = wasm_v128_load(x + i), yv = wasm_v128_load(y + i);
    yv = madd(a, xv, yv);
    yv = nmadd(b, xv, yv);
    wasm_v128_store(y + i, yv);
  }
  double s = 0;
  for (int i = 0; i < n; i++) s += y[i];
  free(x);
  free(y);
  return s;
}

// A small matrix product C = A*B (n x n, column major), the inner loop in
// fused multiply-adds. Returns the number of floating-point operations, so the
// page can time it.
EXPORT double matmul(int n, int reps) {
  double *a = alloc_doubles(n * n);
  double *b = alloc_doubles(n * n);
  double *c = alloc_doubles(n * n);
  for (int i = 0; i < n * n; i++) {
    a[i] = 1.0 / (1 + i % 11);
    b[i] = 1.0 / (1 + i % 13);
  }
  for (int r = 0; r < reps; r++) {
    memset(c, 0, n * n * sizeof(double));
    for (int j = 0; j < n; j++)
      for (int k = 0; k < n; k++) {
        v128_t bkj = wasm_f64x2_splat(b[k + j * n]);
        for (int i = 0; i + 1 < n; i += 2) {
          v128_t cv = wasm_v128_load(c + i + j * n);
          cv = madd(wasm_v128_load(a + i + k * n), bkj, cv);
          wasm_v128_store(c + i + j * n, cv);
        }
      }
  }
  volatile double sink = c[n * n - 1];
  (void)sink;
  free(a);
  free(b);
  free(c);
  return 2.0 * n * n * n * reps;
}

// C++ exceptions (wasm exception handling, the legacy encoding by default).
__attribute__((noinline)) static void fail_if(int v) {
  if (v) throw std::runtime_error("expected");
}

EXPORT int cxx_exception(void) {
  try {
    fail_if(1);
  } catch (const std::runtime_error &e) {
    return strcmp(e.what(), "expected") == 0 ? 1 : -1;
  }
  return 0;
}

// setjmp/longjmp, built on wasm exception handling (-sSUPPORT_LONGJMP=wasm).
static jmp_buf env;
__attribute__((noinline)) static void jump(int v) { longjmp(env, v); }

EXPORT int long_jump(void) {
  volatile int n = 0;
  int v = setjmp(env);
  if (v == 0) {
    n = 1;
    jump(42);
  }
  return (n == 1 && v == 42) ? 1 : 0;
}

// Atomics on the module's own shared memory, from inside wasm.
static std::atomic<int> counter{0};

EXPORT int atomic_add(int k) {
  for (int i = 0; i < k; i++) counter.fetch_add(1);
  return counter.load();
}

// memory.atomic.wait32 in a worker: wait 1 ms for a value that never changes.
// Returns 2 (timed out), which is the only correct answer here.
EXPORT int atomic_wait_timeout(void) {
  static int32_t word = 0;
  return __builtin_wasm_memory_atomic_wait32(&word, 0, 1000000);
}

// Grow the heap by mb megabytes (memory.grow on the shared memory), touch it
// (memory.fill, memory.copy), and give it back. Returns 1 on success.
EXPORT int grow(int mb) {
  size_t n = (size_t)mb << 20;
  char *p = (char *)malloc(n);
  if (!p) return 0;
  memset(p, 7, n);
  memcpy(p, p + n / 2, n / 2);
  int ok = p[0] == 7 && p[n - 1] == 7;
  free(p);
  return ok;
}

// A buffer other workers write into directly, through their view of this
// module's memory.
EXPORT unsigned char *mailbox(int n) {
  static unsigned char *box = nullptr;
  if (!box) box = (unsigned char *)malloc(n);
  return box;
}

EXPORT unsigned checksum(const unsigned char *p, int n) {
  unsigned s = 0;
  for (int i = 0; i < n; i++) s = s * 31 + p[i];
  return s;
}

// Read a file the page put into the in-memory file system. Returns the
// checksum of its bytes, or -1.
EXPORT long read_file(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return -1;
  unsigned char buf[4096];
  unsigned s = 0;
  size_t k;
  while ((k = fread(buf, 1, sizeof buf, f)) > 0)
    for (size_t i = 0; i < k; i++) s = s * 31 + buf[i];
  fclose(f);
  return (long)(s & 0x7fffffff);
}
