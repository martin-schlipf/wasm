;; SIMD128: double-precision lanes, integer lanes and the 64-bit compares
(module
  (func (export "f") (param v128 v128) (result v128)
    (v128.and
      (f64x2.add (local.get 0) (f64x2.mul (local.get 0) (local.get 1)))
      (i64x2.lt_s (local.get 0) (i32x4.add (local.get 1) (local.get 1))))))
