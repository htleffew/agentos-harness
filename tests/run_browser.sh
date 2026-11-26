#!/bin/bash
# Run every browser suite once, in order, against one SillyTavern host and print one line per suite.
#
#   bash tests/run_browser.sh                  every suite in tests/browser-suites.txt
#   bash tests/run_browser.sh t_shared t_style only those suites, in the order given
#
# The host and its mock are started by the caller. Set the variables the suites read (see tests/README.md):
#   RI_HOST_URL, RI_MOCK_PORT, RI_MOCK_LOG, RI_MOCK_MODE, RI_MOCK_DIR (the mock's folder, where delay.txt lives),
#   RI_PLAYWRIGHT, RI_CHROME, RI_PROFILE, RI_ST_DIR, RI_ST_DATA and RI_EXTENSION_SOURCE.
# RI_SUITE_LOGS is the folder for one log per suite (default: a folder under the temp directory).
# RI_SUITE_TIMEOUT is the limit per suite in seconds (default 1200). The exit status is the number of failed suites.
#
# Each suite starts from a fresh mock mode ({}). The suites listed in the DELAY line below also need the mock to
# answer after 900 ms, which the script sets through RI_MOCK_DIR/delay.txt and clears afterwards.
cd "$(dirname "$0")/.." || exit 1
LOGS=${RI_SUITE_LOGS:-${TMPDIR:-/tmp}/ri-suite-logs}
mkdir -p "$LOGS"
DELAY=" t_composer_bar t_results_sheet t_quick_action_setup t_menu_shell t_integration "
if [ $# -gt 0 ]; then
  SUITES="$*"
else
  SUITES=$(grep -v -E '^\s*(#|$)' tests/browser-suites.txt | awk '{print $1}')
fi
# Each suite starts from the same host settings. The settings file is saved once with the extension's own
# settings removed, and put back before every suite, so one suite's stored state (a customized prompt, a chat
# with memory on and its background chapter jobs) never reaches the next suite's page or request counts.
# A mock started before a pull that changed tests/mock.js answers new prompts as plain replies; stop before any suite.
if [ -n "$RI_MOCK_PORT" ]; then
  node -e "const c=require('crypto'),fs=require('fs');const want=c.createHash('sha256').update(fs.readFileSync('tests/mock.js')).digest('hex');fetch('http://127.0.0.1:'+process.argv[1]+'/mock/source').then(r=>r.text()).then(got=>{if(got.trim()!==want){console.error('The mock on port '+process.argv[1]+' runs an older tests/mock.js; restart it.');process.exit(1)}},e=>{console.error('No mock answers on port '+process.argv[1]+': '+e.message);process.exit(1)})" "$RI_MOCK_PORT" || exit 1
fi
SETTINGS=""
if [ -n "$RI_ST_DATA" ] && [ -f "$RI_ST_DATA/default-user/settings.json" ]; then
  SETTINGS="$RI_ST_DATA/default-user/settings.json"
  # The saved settings carry one chain per background job with only the Main API in it, so the mock is the one route
  # (the recommended chains start with a desktop and a NanoGPT plan that a test host does not have).
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const chains={};for(const job of ['judgment','capture','chapter','tidy','catchUp','catchUpNow','carryOver'])chains[job]=[{route:'main'}];d.extension_settings=d.extension_settings||{};d.extension_settings.roleplay_instructions={routing:{version:1,routes:{},chains}};fs.writeFileSync(process.argv[2],JSON.stringify(d))" "$SETTINGS" "$LOGS/settings.clean.json"
fi
# The rest of the user folder (presets, World Info books, chats, saved stacks) is saved once too and put back before
# every suite, so files one suite leaves behind never reach the next suite or the next sweep (tests/host_reset.cjs).
USER_DIR=""
if [ -n "$RI_ST_DATA" ] && [ -d "$RI_ST_DATA/default-user" ]; then
  USER_DIR="$RI_ST_DATA/default-user"
  node tests/host_reset.cjs save "$USER_DIR" "$LOGS/user.snapshot" || exit 1
fi
FAILED=0
for suite in $SUITES; do
  if [ -n "$USER_DIR" ]; then node tests/host_reset.cjs restore "$USER_DIR" "$LOGS/user.snapshot"; fi
  # Install this checkout's extension before every suite, so a suite that does not load tests/lib.js never runs against an
  # earlier copy (its result would depend on which suite ran before it).
  if [ -n "$RI_ST_DIR" ] && [ -n "$RI_EXTENSION_SOURCE" ]; then node -e "require('./tests/lib.js').sync()" || exit 1; fi
  if [ -n "$SETTINGS" ]; then sleep 1; cp "$LOGS/settings.clean.json" "$SETTINGS"; fi
  suite=${suite%.js}
  file=tests/$suite.js
  case $suite in *.cjs) file=tests/$suite;; esac
  if [ ! -f "$file" ]; then echo "MISSING $suite"; FAILED=$((FAILED + 1)); continue; fi
  [ -n "$RI_MOCK_MODE" ] && echo '{}' > "$RI_MOCK_MODE"
  [ -n "$RI_MOCK_DIR" ] && rm -f "$RI_MOCK_DIR/mode.txt" "$RI_MOCK_DIR/delay.txt"
  if [ -n "$RI_MOCK_DIR" ] && [[ "$DELAY" == *" $suite "* ]]; then echo 900 > "$RI_MOCK_DIR/delay.txt"; fi
  started=$(date +%s)
  timeout "${RI_SUITE_TIMEOUT:-1200}" node "$file" > "$LOGS/$(basename "$suite").log" 2>&1
  code=$?
  seconds=$(( $(date +%s) - started ))
  if [ $code -eq 0 ]; then echo "PASS $suite (${seconds}s)"; else echo "FAIL $suite exit $code (${seconds}s) $LOGS/$(basename "$suite").log"; FAILED=$((FAILED + 1)); fi
done
[ -n "$RI_MOCK_DIR" ] && rm -f "$RI_MOCK_DIR/delay.txt"
# Put the user folder back as it was before the first suite (settings.json included), so the state the last suite left
# never becomes the next run's starting point.
if [ -n "$USER_DIR" ]; then node tests/host_reset.cjs restore "$USER_DIR" "$LOGS/user.snapshot"; fi
echo "browser suites failed: $FAILED"
exit $FAILED
