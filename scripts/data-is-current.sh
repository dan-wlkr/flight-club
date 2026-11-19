#!/usr/bin/env bash
# Prints "skip=true" when data.js was already refreshed since the most recent Thursday 04:00 UTC,
# otherwise "skip=false". The workflow runs daily, and this lets it catch up after a missed
# Thursday without updating twice in one week. Set NOW (epoch seconds) to test other dates.
set -euo pipefail

file="${1:-data.js}"
now="${NOW:-$(date -u +%s)}"

last=$(grep -o 'FC_UPDATED="[^"]*"' "$file" | cut -d'"' -f2 || true)
if [ -z "$last" ]; then
  echo "no FC_UPDATED in $file, so updating" >&2
  echo "skip=false"
  exit 0
fi

last_s=$(date -u -d "$last" +%s)
today=$(date -u -d "@$now" +%F)
dow=$(date -u -d "@$now" +%u)                       # 1 = Monday ... 7 = Sunday; Thursday is 4
slot=$(date -u -d "$today 04:00" +%s)
slot=$(( slot - ((dow - 4 + 7) % 7) * 86400 ))      # back to this week's Thursday
if [ "$now" -lt "$slot" ]; then slot=$(( slot - 7 * 86400 )); fi   # Thursday before 04:00 counts as last week's

echo "last update $last; most recent Thursday slot $(date -u -d "@$slot" +%FT%TZ)" >&2
if [ "$last_s" -ge "$slot" ]; then echo "skip=true"; else echo "skip=false"; fi
