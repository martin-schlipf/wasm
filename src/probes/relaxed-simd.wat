;; Relaxed SIMD: fused multiply-add on two doubles
(module
  (func (export "f") (param v128 v128 v128) (result v128)
    (f64x2.relaxed_nmadd (local.get 0) (local.get 1)
      (f64x2.relaxed_madd (local.get 0) (local.get 1) (local.get 2)))))
