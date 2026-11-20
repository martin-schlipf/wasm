;; Sign extension and non-trapping float-to-int conversion
(module
  (func (export "f") (param i32 f64) (result i32)
    (i32.add (i32.extend8_s (local.get 0)) (i32.trunc_sat_f64_s (local.get 1)))))
