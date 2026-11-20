;; Threads: a shared memory as large as 4 GiB, atomic read-modify-write, wait and notify
(module
  (memory (export "memory") 1 65536 shared)
  (func (export "f") (param i32) (result i32)
    (drop (i32.atomic.rmw.cmpxchg (local.get 0) (i32.const 0) (i32.const 1)))
    (drop (memory.atomic.notify (local.get 0) (i32.const 1)))
    (memory.atomic.wait32 (local.get 0) (i32.const 5) (i64.const 0))))
