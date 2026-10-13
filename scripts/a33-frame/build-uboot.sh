#!/usr/bin/env bash
# Build the read-only PF1007L U-Boot (mainline v2025.10 + pf1007l-uboot.patch) in Docker.
# Outputs go to the ignored diagnostics/a33-uboot-out/. Nothing here touches a device.
#
#   scripts/a33-frame/build-uboot.sh
#
# Needs git and a running Docker daemon (Docker Desktop, Colima, or Docker on Linux).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SRC="$REPO/diagnostics/u-boot"
OUT="$REPO/diagnostics/a33-uboot-out"
COMMIT=e50b1e8715011def8aff1588081a2649a2c6cd47 # v2025.10

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin https://github.com/u-boot/u-boot.git
  git -C "$SRC" fetch -q --depth 1 origin "$COMMIT"
  git -C "$SRC" checkout -q FETCH_HEAD
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ] || { echo "STOP: $SRC is not at $COMMIT"; exit 1; }

if git -C "$SRC" diff --quiet; then
  git -C "$SRC" apply "$HERE/pf1007l-uboot.patch"
elif ! git -C "$SRC" apply --reverse --check "$HERE/pf1007l-uboot.patch" 2>/dev/null; then
  echo "STOP: $SRC has changes other than pf1007l-uboot.patch"; exit 1
fi

docker build -q -t pf1007l-uboot-build "$HERE" > /dev/null
mkdir -p "$OUT"
cp "$HERE/ums-readonly.cmd" "$OUT/"

docker run --rm -v "$SRC":/src:ro -v "$OUT":/out pf1007l-uboot-build bash -c '
set -e
export CROSS_COMPILE=arm-linux-gnueabihf-
cp -a /src /tmp/src && cd /tmp/src
make O=/build pf1007l_backup_defconfig > /dev/null
make O=/build -j"$(nproc)" > /out/build.log 2>&1 || { tail -40 /out/build.log; exit 1; }
cp /build/u-boot-sunxi-with-spl.bin /build/.config /out/
mkimage -C none -A arm -T script -d /out/ums-readonly.cmd /out/ums-readonly.scr > /dev/null
grep -E "^CONFIG_(DRAM_CLK|DRAM_ZQ|MMC_SUNXI_SLOT_EXTRA|USB_MUSB_GADGET|CMD_USB_MASS_STORAGE|CRC32_VERIFY|BOOTDELAY)=" /build/.config
'

# The SPL must stay clear of the early stack/global-data area (about 0x5f20 with the
# default 0x2000 early malloc).
python3 -I - "$OUT/u-boot-sunxi-with-spl.bin" <<'EOF'
import sys
spl = open(sys.argv[1], 'rb').read()[:0x6000]
end = max(i for i, b in enumerate(spl) if b) + 1
print(f"SPL code ends at {end:#x}")
if end > 0x5e00:
    sys.exit("STOP: SPL is too close to the stack/global-data area")
EOF

shasum -a 256 "$OUT/u-boot-sunxi-with-spl.bin" "$OUT/ums-readonly.scr" 2>/dev/null \
  || sha256sum "$OUT/u-boot-sunxi-with-spl.bin" "$OUT/ums-readonly.scr"
