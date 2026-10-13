#!/usr/bin/env bash
# Copies every image and PDF the new site uses from the old WordPress uploads folder
# into wp-content/uploads/ — the same paths WordPress used, so old shared links keep working.
#
# Run this from the repo root on your own computer BEFORE switching DNS away from WordPress:
#   bash scripts/import-wp-media.sh
# Then set  media_base: "/wp-content/uploads"  in _config.yml and commit the wp-content folder.
set -euo pipefail

SRC="https://mtcatlanta.org/wp-content/uploads"
DEST="wp-content/uploads"   # same paths as WordPress, so old links keep working
mkdir -p "$DEST"

# Every path in _data/*.yml that looks like YYYY/MM/filename, plus layout images
paths=$(grep -hoE '[0-9]{4}/[0-9]{2}/[^"[:space:]]+\.(jpe?g|png|gif|webp|pdf)' _data/*.yml || true)
paths="$paths
2026/03/Logo-MTCA-1.png
2026/03/marthoma-church.png
2026/03/gallery_banner.jpg"

ok=0; fail=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  mkdir -p "$DEST/$(dirname "$p")"
  if [ -s "$DEST/$p" ]; then ok=$((ok+1)); continue; fi
  if curl -A "Mozilla/5.0 (site migration)" -fsSL --retry 2 -o "$DEST/$p" "$SRC/$p"; then ok=$((ok+1)); else echo "FAILED: $p"; rm -f "$DEST/$p"; fail=$((fail+1)); fi
done <<< "$(echo "$paths" | sort -u)"

echo "Downloaded/present: $ok   Failed: $fail"
[ "$fail" -eq 0 ] || exit 1
echo "Next: set media_base: \"/wp-content/uploads\" in _config.yml, then commit."
