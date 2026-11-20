# WebAssembly browser check

A single web page that tells whether a browser can run a large, multi-threaded
numerical application compiled to WebAssembly, and a CI that opens it in the
browsers that matter: Chrome, Firefox, Edge, Safari on macOS and Safari on iOS,
current versions and about three years old ones.

Open the page, wait a few seconds, read the verdict:

- ✅ **can run the application**: everything works, including relaxed SIMD.
- ⚠️ **can run it only from a build without relaxed SIMD**: everything but
  relaxed SIMD works, so a second build that uses SIMD128 only is needed for
  this browser.
- ❌ **cannot run it**: the table below the verdict says what is missing.

## What it tests

The application this page stands in for is compiled C/C++/Fortran with these
properties. The page tests each of them, first on its own and then all together
in a real module.

| what | how the page tests it |
|---|---|
| SIMD128, double-precision lanes | probe module; arithmetic checked against JavaScript |
| relaxed SIMD (`f64x2.relaxed_madd`) | probe module; a second build of the test module uses it |
| threads: shared memory, atomics, `memory.atomic.wait32` | probe module; atomics and a wait inside the test module, in a worker |
| bulk memory, passive data segments | probe module; the compiler emits them for any shared memory |
| exception handling, legacy encoding (`try`/`catch`/`delegate`) | probe module; setjmp/longjmp and C++ exceptions in the test module |
| sign extension, non-trapping float-to-int | probe module |
| a shared memory per worker, 256 MiB to start, up to 4 GiB | the test module's memory, and 4 such memories allocated at once |
| growing a shared memory | one worker grows its memory by 512 MiB |
| cross-origin isolation (`SharedArrayBuffer`) | the page needs it; see [Hosting](#hosting) |
| one module compiled on the page and posted to workers | the test module, in 4 classic workers loaded with `importScripts` |
| workers reading and writing each other's memory, `Atomics.wait` in workers | a barrier and a ring exchange of 1 MiB per worker |
| synchronous `XMLHttpRequest` in a worker | each worker fetches `data.json`, puts it into the in-memory file system, and C stdio reads it |
| `WebAssembly.compileStreaming` with `application/wasm` | compiling the test module |

It also times a small matrix product in both builds, so the CI summary shows
what relaxed SIMD gains on each browser and machine. Those timings come from
shared CI machines: compare them within one run, not across runs.

URL parameters: `workers=<n>` (default 4), `grow=<MiB>` (default 512, `0` to
skip), `nocoi` (do not install the isolation service worker),
`report=<path>` (POST the result as JSON there; CI uses it).

## Layout

| path | what |
|---|---|
| `site/` | the page: `index.html`, `app.js` (main thread), `worker.js` (one worker), `coi.js` (cross-origin isolation for static hosts), `data.json` |
| `src/module.cpp` | the test module, built twice: with and without relaxed SIMD |
| `src/probes/*.wat` | one tiny module per feature; the first line is its title |
| `tools/serve.mjs` | a local server with the right headers |
| `tools/run.mjs` | runs the page in one browser and writes its result |
| `tools/safari.mjs`, `tools/playwright.mjs`, `tools/ios.sh` | ways of opening the page in Safari (WebDriver), in Playwright's browsers, and in iOS simulators |
| `tools/summarize.mjs` | the results of a CI run as one Markdown table |
| `tools/check-features.sh`, `tools/features.txt` | the drift check: does a module need anything the page does not test? |
| `.github/workflows/browsers.yml` | the browser matrix: on push, pull request, weekly, and by hand |
| `.github/workflows/pages.yml` | publishes the page on GitHub Pages |

## Building and running it locally

Needs emscripten (`emcc`, and binaryen's `wasm-as`, which comes with it) and
node.

```sh
make            # build/site/
make serve      # http://localhost:8000/
```

To run it in a browser and get the result as a file, as CI does:

```sh
node tools/run.mjs --name "my Chrome" --out results/chrome.json -- \
  google-chrome --headless=new --user-data-dir=/tmp/profile '{url}'
node tools/summarize.mjs results
```

## CI

`browsers.yml` builds the page once with a pinned emscripten, then runs it in:

| runner | browsers |
|---|---|
| Linux | Chrome and Firefox as installed on the image (current), Chrome 119 and Firefox 120 (November 2023), WebKit as built by Playwright |
| Windows | Edge and Firefox as installed on the image |
| macOS, two image versions | Safari as installed, through `safaridriver`; Safari in the newest three iOS simulator runtimes of each image |

The run's summary page has one table of all results. A job fails only if the
page did not report; a browser that cannot run the application is a result.
The weekly run catches new browser versions and new runner images.

### Limits

- **Playwright's WebKit is not Safari.** It is close, but its JavaScript engine
  is not the one any Safari ships. The Safari rows are the ones that count.
- **Safari versions come with the images.** macOS runners have one Safari each;
  older Safari versions are reached through older iOS simulator runtimes, as
  far back as the images keep them.
- **A simulator is not a phone.** It runs on the Mac's CPU and memory, without
  the memory limits iOS puts on a real device. Whether 4 workers with up to
  4 GiB each fit on an actual iPhone is a question only an iPhone answers: open
  the published page on one.
- **Timings come from shared machines** and say little about real devices.

## Hosting

Shared memory between workers needs the page to be cross-origin isolated:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`tools/serve.mjs` sends these. GitHub Pages cannot, so `coi.js` installs a
service worker that adds them and reloads the page once. To publish the page,
set Settings → Pages → Source to "GitHub Actions"; `pages.yml` then deploys
every push to `main`.

## The drift check

The page is only useful while it tests everything the real application needs.
`tools/check-features.sh` checks a module against `tools/features.txt`: every
instruction it uses must belong to a feature listed there, relaxed SIMD and the
two encodings of exception handling included, and its memory must be shared
and start no larger than the page's. Run it on every module you ship:

```sh
tools/check-features.sh path/to/application.wasm
```

When it fails, the application has outgrown the page: add a probe and a check
for the new feature, then add the feature to `features.txt`.

## License

Apache License 2.0, see [LICENSE](LICENSE).
