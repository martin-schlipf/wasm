;; Exception handling, the newer exnref encoding (try_table, throw_ref)
(module
  (tag $e (param i32))
  (func (export "f") (param i32) (result i32)
    (block $h (result i32)
      (try_table (catch $e $h) (throw $e (local.get 0)))
      (i32.const 0))))
