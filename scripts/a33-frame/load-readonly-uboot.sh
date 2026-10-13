#!/usr/bin/env bash
# RAM-boot the PF1007L read-only eMMC USB disk from FEL. No device flash write.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$REPO/diagnostics/a33-uboot-out"
FEL="${SUNXI_FEL:-$REPO/diagnostics/sunxi-tools/sunxi-fel}"

if [ ! -x "$FEL" ]; then
  FEL="$REPO/diagnostics/sunxi-fel"
fi
if [ ! -x "$FEL" ]; then
  FEL="$(command -v sunxi-fel || true)"
fi
[ -x "$FEL" ] || { echo "STOP: sunxi-fel is unavailable" >&2; exit 1; }
[ -f "$OUT/u-boot-sunxi-with-spl.bin" ] || { echo "STOP: build U-Boot first" >&2; exit 1; }
[ -f "$OUT/ums-readonly.scr" ] || { echo "STOP: build U-Boot first" >&2; exit 1; }

devices="$("$FEL" -l || true)"
[[ "$devices" == *"Allwinner A33"* ]] || { echo "STOP: expected an A33 in FEL" >&2; exit 1; }
[[ "$(printf '%s\n' "$devices" | wc -l | tr -d ' ')" == 1 ]] || {
  echo "STOP: expected exactly one FEL device" >&2
  exit 1
}

"$FEL" uboot "$OUT/u-boot-sunxi-with-spl.bin" write 0x43100000 "$OUT/ums-readonly.scr"
