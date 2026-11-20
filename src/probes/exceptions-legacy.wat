;; Exception handling, legacy encoding (try, catch, catch_all, rethrow, delegate):
;; what compilers emit by default
(module
  (tag $e (param i32))
  (func $thrower (param i32) (throw $e (local.get 0)))
  (func (export "f") (param i32) (result i32)
    (try (result i32)
      (do
        (try
          (do (try (do (call $thrower (local.get 0))) (delegate 0)))
          (catch_all (rethrow 0)))
        (i32.const 0))
      (catch $e))))
