#!/bin/bash
# Runs the page in Safari on every iOS simulator runtime this Mac has (the
# newest IOS_RUNTIMES of them, default 3), one fresh iPhone simulator each.
# The Safari of a simulator is the Safari of that iOS version, so this is how
# CI reaches older Safari versions. A simulator runs on the Mac's CPU and
# memory: it does not have the memory limits of a real device.
#
#   tools/ios.sh <results-dir>
set -euo pipefail
out=${1:?usage: ios.sh <results-dir>}
keep=${IOS_RUNTIMES:-3}
mkdir -p "$out"

xcrun simctl list runtimes -j > runtimes.json
# "<identifier> <version> <device type>", newest first; the device type is the
# last iPhone the runtime supports.
node -e '
  const r = require("./runtimes.json").runtimes
    .filter((x) => x.platform === "iOS" && x.isAvailable)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  for (const x of r.slice(0, Number(process.argv[1]))) {
    const phones = (x.supportedDeviceTypes || []).filter((d) => d.productFamily === "iPhone");
    if (phones.length) console.log(x.identifier, x.version, phones[phones.length - 1].identifier);
  }' "$keep" > runtimes.txt
rm runtimes.json
if [ ! -s runtimes.txt ]; then echo "ios.sh: no iOS simulator runtime on this Mac" >&2; exit 1; fi

host="macOS $(sw_vers -productVersion | cut -d. -f1)"
status=0
while read -r runtime version devtype; do
  echo "::group::iOS $version ($devtype)"
  udid=$(xcrun simctl create "check-$version" "$devtype" "$runtime")
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b > /dev/null
  # Start Safari first: a freshly booted simulator is slow to start it, and
  # openurl then gives up ("Operation timed out") although the page still
  # opens. So its exit status is ignored, and only the page's report counts.
  xcrun simctl launch "$udid" com.apple.mobilesafari > /dev/null || true
  sleep 10
  node tools/run.mjs --name "Safari, iOS $version (simulator on $host)" \
    --out "$out/ios-$version.json" --timeout 300 --ignore-exit 1 \
    -- xcrun simctl openurl "$udid" '{url}' || status=1
  xcrun simctl shutdown "$udid" || true
  xcrun simctl delete "$udid" || true
  echo "::endgroup::"
done < runtimes.txt
rm runtimes.txt
exit $status
