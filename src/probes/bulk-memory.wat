;; Bulk memory: fill, copy, and passive data segments
(module
  (memory 1)
  (data $d "abcd")
  (func (export "f") (param i32)
    (memory.fill (local.get 0) (i32.const 0) (i32.const 16))
    (memory.copy (i32.const 64) (local.get 0) (i32.const 16))
    (memory.init $d (i32.const 128) (i32.const 0) (i32.const 4))
    (data.drop $d)))
