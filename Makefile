# Builds the page into build/site/: the files of site/, the two builds of the
# test module, and the feature probes. Needs emscripten (emcc) and binaryen
# (wasm-as, which comes with emscripten; emscripten's config says where), and
# node. Works without a Unix shell, so also with make on Windows.
#
#   make            build/site/
#   make serve      serve it on http://localhost:8000 with the right headers
#   make clean

EMCC    ?= emcc
# emsdk's own node: emsdk puts a folder named node on the PATH before any node.
NODE    ?= $(or $(EMSDK_NODE),node)
# emsdk puts emcc on the PATH but not binaryen's tools.
WASM_AS ?= $(shell em-config BINARYEN_ROOT)/bin/wasm-as
OUT     := build/site

# The link flags of the application this page stands in for: a shared memory
# that starts at 256 MiB and may grow to 4 GiB, wasm exception handling, a
# MODULARIZE loader for the page and its workers, and an in-memory file system.
CFLAGS  := -O2 -msimd128 -matomics -mbulk-memory -fwasm-exceptions
LDFLAGS := -sSHARED_MEMORY=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB \
           -sINITIAL_MEMORY=256MB -sSTACK_SIZE=64MB \
           -sSUPPORT_LONGJMP=wasm -sMODULARIZE=1 -sEXPORT_NAME=createModule \
           -sENVIRONMENT=web,worker -sFORCE_FILESYSTEM=1 \
           -sEXPORTED_RUNTIME_METHODS=FS,stringToNewUTF8 \
           -sEXPORTED_FUNCTIONS=_malloc,_free \
           -Wl,--no-check-features

SITE   := $(wildcard site/*)
PROBES := $(sort $(wildcard src/probes/*.wat))

all: $(OUT)/index.html $(OUT)/module-relaxed.js $(OUT)/module-simd.js $(OUT)/probes.js

$(OUT)/index.html: $(SITE) | $(OUT)
	$(NODE) tools/files.mjs cp $(SITE) $(OUT)

$(OUT)/module-relaxed.js: src/module.cpp | $(OUT)
	$(EMCC) $(CFLAGS) -mrelaxed-simd $< $(LDFLAGS) -o $@

$(OUT)/module-simd.js: src/module.cpp | $(OUT)
	$(EMCC) $(CFLAGS) $< $(LDFLAGS) -o $@

$(OUT)/probes.js: $(PROBES) tools/probes.mjs | $(OUT)
	$(NODE) tools/probes.mjs "$(WASM_AS)" $@ $(PROBES)

$(OUT):
	$(NODE) tools/files.mjs mkdir $@

serve: all
	$(NODE) tools/serve.mjs --root $(OUT) --port 8000

clean:
	$(NODE) tools/files.mjs rm build

.PHONY: all serve clean
