#!/bin/sh
# What a git cell (test 207) shows of a run of node --test that failed: usage: failing-tests.sh <log of the run>
# The reporter ends the log with the section of every failing test and its whole detail; a run with no such section ended in a crash, so its end is shown.
if grep -q '^✖ failing tests:' "$1"; then
  sed -n '/^✖ failing tests:/,$p' "$1"
else
  tail -n 200 "$1"
fi
