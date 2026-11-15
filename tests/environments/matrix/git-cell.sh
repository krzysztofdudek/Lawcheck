#!/bin/sh
# One cell of the git matrix (spec/environments.md, test 207), run as root in a clean official image with /cell mounted read-only: /cell/node (the Node 24 that starts it), /cell/repo (a checkout with dist and node_modules) and this script.
# Usage: git-cell.sh <test file>...
set -u
say() { printf 'cell: %s\n' "$*"; }
if ! command -v git > /dev/null 2>&1; then
  { apt-get update -qq && apt-get install -y -qq git; } > /tmp/cell-step.log 2>&1 || { tail -20 /tmp/cell-step.log; say "could not run: apt-get install git"; exit 3; }
fi
say "git $(git --version)"
id tester > /dev/null 2>&1 || useradd -m -u 4242 tester > /dev/null 2>&1 || adduser -D -u 4242 tester > /dev/null 2>&1
# The tests write their temporary folders below TMPDIR, and run as a user other than root so that a file mode can make a file unreadable.
su tester -s /bin/sh -c "cd /cell/repo && HOME=/tmp/home TMPDIR=/tmp PATH=/cell/node:\$PATH node --test $*" > /tmp/cell-tests.log 2>&1
code=$?
grep -E '^(✖|ℹ (tests|pass|fail|skipped))' /tmp/cell-tests.log | sed 's/^/cell: /'
if [ $code -ne 0 ]; then grep -A30 '^✖' /tmp/cell-tests.log | head -120; fi
say done
exit $code
