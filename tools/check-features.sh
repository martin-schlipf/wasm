#!/bin/bash
# Checks that a WebAssembly module needs no feature this page does not test
# (tools/features.txt), so that what the page says about a browser holds for
# that module. Run it on every module you ship.
#
#   tools/check-features.sh [--features tools/features.txt] module.wasm...
#
# Needs binaryen's wasm-opt and wasm-dis (they come with emscripten), or set
# WASM_OPT and WASM_DIS. Exits 1 and says why if a module needs more.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
features=$here/features.txt
if [ "${1:-}" = --features ]; then features=$2; shift 2; fi
[ $# -gt 0 ] || { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
WASM_OPT=${WASM_OPT:-wasm-opt}
WASM_DIS=${WASM_DIS:-wasm-dis}

have() { grep -qx "$1" <(grep -v '^#' "$features" | awk '{print $1}'); }

# binaryen's flags for the features the page tests. Mutable globals are older
# than any browser with SIMD, so they are always allowed.
flags=(--mvp-features --enable-mutable-globals)
have simd128 && flags+=(--enable-simd)
have relaxed-simd && flags+=(--enable-relaxed-simd)
have threads && flags+=(--enable-threads)
have bulk-memory && flags+=(--enable-bulk-memory --enable-bulk-memory-opt)
have sign-ext && flags+=(--enable-sign-ext --enable-nontrapping-float-to-int)
{ have exceptions-legacy || have exceptions-exnref; } && flags+=(--enable-exception-handling)
initial=$(awk '$1 == "memory-initial-pages" {print $2}' "$features")

status=0
for wasm in "$@"; do
  bad=()
  # 1. Everything binaryen's validator gates by feature.
  if ! log=$("$WASM_OPT" "${flags[@]}" "$wasm" -o /dev/null 2>&1); then
    need=$(grep -oE '\[--enable-[a-z0-9-]+\]' <<< "$log" | sort -u | tr -d '[]' | sed 's/--enable-//' | tr '\n' ' ')
    bad+=("needs features the page does not test: ${need:-see wasm-opt: $(head -c 300 <<< "$log")}")
  fi
  # 2. What the validator does not tell apart: relaxed SIMD instructions, and
  #    the two encodings of exception handling.
  text=$("$WASM_DIS" --all-features "$wasm")
  have relaxed-simd || ! grep -qE '[0-9]x[0-9]+\.relaxed_' <<< "$text" \
    || bad+=("uses relaxed SIMD")
  have exceptions-exnref || ! grep -qE '\((try_table|throw_ref)\b' <<< "$text" \
    || bad+=("uses the exnref encoding of exception handling (try_table, throw_ref)")
  have exceptions-legacy || ! grep -qE '\((try|rethrow|delegate)\b' <<< "$text" \
    || bad+=("uses the legacy encoding of exception handling (try, rethrow, delegate)")
  # 3. The memory: shared (the page tests nothing else), at most 4 GiB, and
  #    starting no larger than what the page allocates.
  mem=$(grep -m1 -oE '\(memory \$[^ ]+ [0-9]+( [0-9]+)?( shared)?\)' <<< "$text" || true)
  if [ -n "$mem" ]; then
    read -r _ _ init max shared <<< "$(tr -d '()' <<< "$mem")"
    [ "$max" = shared ] && { shared=shared; max=; }
    [ "$shared" = shared ] || bad+=("its memory is not shared, which the page does not test")
    [ -z "$initial" ] || [ "$init" -le "$initial" ] \
      || bad+=("its memory starts at $init pages; the page tests at most $initial")
  fi
  if [ ${#bad[@]} -eq 0 ]; then
    echo "check-features: $wasm: ok"
  else
    status=1
    for b in "${bad[@]}"; do echo "check-features: $wasm: $b" >&2; done
  fi
done
exit $status
