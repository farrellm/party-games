#!/usr/bin/env bash
# Regenerate the raster icons from public/favicon.svg.
# Only needs running when the mark changes; the PNGs are committed.
set -euo pipefail
cd "$(dirname "$0")/.."

for size in 192 512; do
  rsvg-convert -w "$size" -h "$size" public/favicon.svg -o "public/pwa-$size.png"
done

# iOS ignores transparency and squares the corners itself, so this is the same
# mark on the same ground at the size Safari asks for.
rsvg-convert -w 180 -h 180 public/favicon.svg -o public/apple-touch-icon.png

echo "wrote public/pwa-192.png public/pwa-512.png public/apple-touch-icon.png"
