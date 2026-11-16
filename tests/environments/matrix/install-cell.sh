#!/bin/sh
# One cell of the install matrix (spec/environments.md, test 206), run as root in a clean official image with /cell mounted read-only: /cell/lawcheck.tgz, /cell/sample and this script.
# Usage: install-cell.sh <npm|pnpm|yarn1|yarn4|yarn4-pnpm|yarn4-pnp|bun> <pass|refuse> [<node|bun|pnp: the refusal it expects>]
set -u
CELL=$1
EXPECT=$2
CAUSE=${3:-}
failed=0
say() { printf 'cell: %s\n' "$*"; }
ok() { say "ok $*"; }
bad() { say "fail $*"; failed=1; }
couldnot() { say "could not run: $*"; exit 3; }

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI= npm_config_update_notifier=false
quiet() { "$@" > /tmp/cell-step.log 2>&1 || { tail -20 /tmp/cell-step.log; return 1; }; }

if ! command -v git > /dev/null 2>&1; then
  if command -v apk > /dev/null 2>&1; then quiet apk add --no-cache git || couldnot "apk add git"
  else quiet sh -c 'apt-get update -qq && apt-get install -y -qq git' || couldnot "apt-get install git"; fi
fi
say "git $(git --version)"
if command -v node > /dev/null 2>&1; then say "node $(node --version)"; else say "node none"; fi

work=$(mktemp -d)
cp -R /cell/sample/. "$work/"
cd "$work" || couldnot "cd $work"
printf 'node_modules/\n.yarn/\n.pnp.*\n.yarnrc.yml\nyarn.lock\npnpm-lock.yaml\npnpm-workspace.yaml\nbun.lock\nbun.lockb\npackage-lock.json\npackage.json\n' > .gitignore
printf '{"name":"cell","version":"1.0.0","private":true}\n' > package.json

case $CELL in
  npm) runner=npx; cmd='npx --no-install lawcheck'; json=$cmd ;;
  pnpm) runner=pnpm; cmd='pnpm exec lawcheck'; json=$cmd ;;
  yarn1 | yarn4 | yarn4-pnpm | yarn4-pnp) runner=yarn; cmd='yarn run lawcheck'; json='yarn --silent run lawcheck' ;;
  bun) runner=bun; cmd='bun x --no-install lawcheck'; json=$cmd ;;
  *) couldnot "unknown cell $CELL" ;;
esac
mkdir -p .lawcheck
printf 'runner: %s\n' "$runner" > .lawcheck/config.yaml
git init -q -b main && git add -A && git -c user.name=cell -c user.email=cell@example.com commit -qm sample && git checkout -qb work || couldnot "git"
printf "console.log('one');\n" > src/core/one.ts

case $CELL in
  npm) quiet npm install --save-dev --no-audit --no-fund /cell/lawcheck.tgz || couldnot "npm install" ;;
  pnpm)
    command -v pnpm > /dev/null 2>&1 || quiet npm install --global --no-audit --no-fund pnpm || couldnot "npm install pnpm"
    quiet pnpm add --save-dev /cell/lawcheck.tgz || couldnot "pnpm add" ;;
  yarn1)
    command -v yarn > /dev/null 2>&1 || quiet npm install --global --no-audit --no-fund yarn || couldnot "npm install yarn"
    quiet yarn add --dev file:/cell/lawcheck.tgz || couldnot "yarn add" ;;
  yarn4 | yarn4-pnpm | yarn4-pnp)
    command -v yarn > /dev/null 2>&1 || quiet npm install --global --no-audit --no-fund yarn || couldnot "npm install yarn"
    quiet yarn set version stable || couldnot "yarn set version stable"
    if [ "$CELL" = yarn4 ]; then printf 'nodeLinker: node-modules\n' >> .yarnrc.yml; fi
    if [ "$CELL" = yarn4-pnpm ]; then printf 'nodeLinker: pnpm\n' >> .yarnrc.yml; fi
    # Yarn 4 holds back a package published less than a day ago; docs/config.md gives this line for the first day after a release of Lawcheck or Runes.
    printf 'npmPreapprovedPackages: [lawcheck, "@chrisdudek/runes"]\n' >> .yarnrc.yml
    : > yarn.lock
    quiet yarn add --dev lawcheck@file:/cell/lawcheck.tgz || couldnot "yarn add" ;;
  bun)
    command -v bun > /dev/null 2>&1 || quiet npm install --global --no-audit --no-fund bun || couldnot "npm install bun"
    quiet bun add --dev /cell/lawcheck.tgz || couldnot "bun add" ;;
esac
say "installed by $CELL: $($json --version 2> /dev/null)"

parse() {
  if command -v node > /dev/null 2>&1; then node -e "$1"; else bun -e "$1"; fi
}

first() { printf '%s\n' "$1" | head -n 1; }

# Yarn 1 wraps what yarn run prints in lines of its own, so the outputs that are compared go through the quiet form docs/config.md gives; the plain command must still end as the check does.
version=$($json --version 2> /tmp/cell-stderr.log); code=$?
want=$(tar -xOzf /cell/lawcheck.tgz package/package.json | parse 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
if [ $code -eq 0 ] && [ "$version" = "$want" ]; then ok "--version $version"; else bad "--version printed '$version', exit $code: $(cat /tmp/cell-stderr.log)"; fi

doctor=$($json doctor 2> /dev/null); doctor_code=$?
check=$($json check --base main 2> /dev/null); check_code=$?
try=$($json try no-console src/core/one.ts 2> /dev/null); try_code=$?
$cmd check --base main > /dev/null 2>&1; plain_code=$?
document=$($json check --base main --json 2> /dev/null)
read_json='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log(d.schema+" "+(d.result??"")+" "+(d.findings??d.errors).map(f=>f.code).join(","))})'
parsed=$(printf '%s' "$document" | parse "$read_json" 2>&1); parsed_code=$?

if [ "$EXPECT" = pass ]; then
  if [ $doctor_code -eq 0 ] && [ "$(first "$doctor")" = "$(first "$doctor" | grep '^lawcheck: PASS  ')" ]; then ok "doctor $(first "$doctor")"; else bad "doctor exit $doctor_code: $doctor"; fi
  found=$(printf '%s\n' "$check" | grep -E '^[^ ].*  (error|warning)\[')
  if [ $check_code -eq 1 ] && [ "$found" = "src/core/one.ts:1  error[no-console]  writes to the terminal with console.log" ]; then ok "check finds one thing"; else bad "check exit $check_code: $check"; fi
  if [ $plain_code -eq 1 ]; then ok "$cmd check exits 1"; else bad "$cmd check exit $plain_code"; fi
  if [ $try_code -eq 1 ] && printf '%s\n' "$try" | grep -q '^src/core/one.ts:1  error\[no-console\]  writes to the terminal with console.log$'; then ok "try finds it"; else bad "try exit $try_code: $try"; fi
  if [ $parsed_code -eq 0 ] && [ "$parsed" = "lawcheck-check/0 fail no-console" ]; then ok "check --json through $json parses"; else bad "check --json through $json: $parsed; the output was: $document"; fi
  if [ "$CELL" = npm ]; then
    # spec/environments.md, section 3, a limit: Node with --permission dies resolving the link a package manager installs, before Lawcheck's entry runs.
    quiet npm install --global --no-audit --no-fund /cell/lawcheck.tgz || couldnot "npm install --global"
    out=$(NODE_OPTIONS=--permission lawcheck --version 2> /tmp/cell-permission.log); code=$?
    if [ $code -eq 1 ] && [ -z "$out" ] && grep -q '^Error \[ERR_ACCESS_DENIED\]: Access to this API has been restricted' /tmp/cell-permission.log && grep -q "resource: '.*/lawcheck/dist/bin.cjs'" /tmp/cell-permission.log; then ok "the installed link under --permission ends in Node's ERR_ACCESS_DENIED, exit 1, as the spec states"; else bad "the installed link under --permission: exit $code, $out $(cat /tmp/cell-permission.log)"; fi
  fi
else
  case $CAUSE in
    node) expected="lawcheck: ERROR  Node $(node --version | sed 's/^v//') is older than 24, the oldest Node Lawcheck runs on" ;;
    bun) expected="lawcheck: ERROR  this run is on Bun $(bun --version), and Lawcheck runs on Node 24 or later; no node is on the PATH" ;;
    pnp) expected="lawcheck: ERROR  Yarn Plug'n'Play is not supported: Lawcheck is served from the archive $(basename "$(find / -name 'lawcheck-*.zip' 2> /dev/null | head -n 1)"), which the runner of script rules cannot open" ;;
    *) couldnot "unknown refusal $CAUSE" ;;
  esac
  for out in "$doctor" "$check" "$try"; do
    if [ "$(first "$out")" != "$expected" ]; then bad "the first line is not '$expected': $out"; fi
    case "$out" in *rule-crashed* | *'.lawcheck/rules/'*) bad "a rule file is blamed: $out" ;; esac
  done
  if [ "$(first "$doctor")" = "$(first "$check")" ] && [ "$(first "$try")" = "$(first "$check")" ]; then ok "doctor, check and try refuse alike: $(first "$check")"; else bad "doctor, check and try differ"; fi
  if [ $doctor_code -eq 2 ] && [ $check_code -eq 2 ] && [ $try_code -eq 2 ] && [ $plain_code -eq 2 ]; then ok "exit 2 each"; else bad "exits $doctor_code $check_code $try_code $plain_code"; fi
  if [ $parsed_code -eq 0 ] && [ "$parsed" = "lawcheck-error/1  unsupported-environment" ]; then ok "check --json through $json parses as the refusal"; else bad "check --json through $json: $parsed; the output was: $document"; fi
fi
say done
exit $failed
