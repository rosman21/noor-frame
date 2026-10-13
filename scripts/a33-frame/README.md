# AEEZO PF1007L: FEL access, eMMC backup and root ADB

> **Read this first.** These steps can leave a frame unbootable if you skip a
> check. They were tested on **one** unit. Boards sold under the same name
> differ, so measure your own frame and never reuse another unit's offsets or
> hashes. You do this at your own risk. The [overview](../../docs/android-frame.md)
> explains the whole route and what each stage changes.

Run every command from the **noor-frame repository root** (`pwd` should end in
`/noor-frame`).

This guide records the route tested on one frame, including the paths that
failed and the 12 MHz eMMC fix:

1. **Back up first.** The first stages make a verified, read-only image of the
   frame's eMMC before anything on Android changes.
2. **Root ADB.** A later, guarded boot change turns on root ADB over USB.
3. **Install Noor.** The [Android kiosk guide](../../apps/kiosk-android/README.md)
   continues from there.

## Identify the hardware

| Identifier | Tested unit |
| --- | --- |
| Seller / manufacturer / model | AEEZO 10.1-inch / YHK / PF1007L |
| Chipset | Allwinner A33 |
| Android board ID | `astar_m86_8723cs` |
| Stock app | AiMOR, `com.efercro.os.aimor` |
| OS / RAM | Android 6.0.1 / 1 GB |
| Display | 1280 × 800 IPS at 160 dpi |
| Internal eMMC | 15,758,000,128 bytes, 30,777,344 sectors |

The [upstream PF1007L guide](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-pf1007l.md)
documents other units with different eMMC sizes. Do not reuse its sector
offsets or firmware identifiers without measuring your unit. Its
[PR #2](https://github.com/wesbos/photo-frame-dashboard/pull/2) discusses a
related board, but its unpublished reader is not needed for this workflow.

## Host and connection

The working route was Mac mini → USB-C-to-USB-A dongle → known USB data cable →
frame. The dongle was verified by mounting a USB thumb drive. FEL also worked
through a CalDigit dock. Use stable power and a spare SD card; the tested card
was 128 GB. The host needs Git, Python 3, make, a C compiler, libusb/libfdt
headers and Docker. On a Homebrew Mac, the host dependencies are:

```sh
brew install libusb dtc pkgconf
```

### 1. Prepare the FEL SD card

The official `fel-sdboot.sunxi` stub holds this non-secure A33 in persistent
FEL. It is tracked at the pinned sunxi-tools revision. Clone and check it:

```sh
git clone https://github.com/linux-sunxi/sunxi-tools.git diagnostics/sunxi-tools
git -C diagnostics/sunxi-tools checkout d7bbd172a5da601a08f94479de308c6fb714a19a
make -C diagnostics/sunxi-tools sunxi-fel
shasum -a 256 diagnostics/sunxi-tools/bin/fel-sdboot.sunxi
```

Expected SHA-256:
`2ccec08a026840571f3804671ba72afae840db27112a43f2b1f122075bc808bc`.
If the clone already exists, verify `git rev-parse HEAD` matches the commit,
then run `make` and the hash check. The card helper also verifies the hash,
8192-byte length and `eGON.BT0` magic.

Identify the **whole spare card** before and after inserting its reader:

```sh
diskutil list external physical
diskutil info diskN
```

Use the current card identifier and exact `Disk Size` byte count from
`diskutil info`. Check external, removable and USB. Never use a partition
such as `diskNs1`. The helper requires an MBR card with all partitions starting
at sector 8192 or later. It rejects GPT, early partitions, unexpected size
and a changed card; it unmounts the card before accessing it. If rejected, choose another spare card;
do not force a layout. It first saves and independently rereads the first 4 MiB,
then writes exactly 8192 bytes at byte offset 8192 and reads the result back.

```sh
sudo python3 -I scripts/a33-frame/fel_card_macos.py backup diskN <CARD_BYTES>
sudo python3 -I scripts/a33-frame/fel_card_macos.py write diskN <CARD_BYTES>
```

Keep `backups/a33-fel-card-prefix.bin.gz` to restore the original bytes. To
restore later, reidentify the same card and run:

```sh
sudo python3 -I scripts/a33-frame/fel_card_macos.py restore diskN <CARD_BYTES>
```

### 2. Confirm FEL

Eject the card from the Mac, insert it into the frame, connect the data cable
and power-cycle (unplug for about five seconds, then reconnect). The tested
frame's screen stayed black. **Black is not enough**: ask the Boot ROM:

```sh
diagnostics/sunxi-tools/sunxi-fel -l
diagnostics/sunxi-tools/sunxi-fel version
```

The first command must list exactly one `Allwinner A33`; the second must
respond. FEL is not a Finder disk or Android shell. If it does not respond,
check card, cable, dongle and power, then power-cycle again.

### 3. Build and RAM-load read-only U-Boot

```sh
scripts/a33-frame/build-uboot.sh
scripts/a33-frame/load-readonly-uboot.sh
```

The build pins U-Boot v2025.10 commit
`e50b1e8715011def8aff1588081a2649a2c6cd47`. Docker cross-compiles the
local patch into ignored `diagnostics/a33-uboot-out/`. The patch enables the
A33 board's MMC2 eMMC and USB mass storage, caps MMC2 at **12 MHz**, reports
USB media as write protected and rejects USB mass-storage writes. The embedded
script runs `ums 0 mmc 1`, exposing **only the eMMC**. The loader requires one
A33 in FEL and sends U-Boot to RAM; it does not flash the frame. It looks for
the pinned `sunxi-fel`, then `diagnostics/sunxi-fel`, then one in `PATH`.

Why 12 MHz matters: at U-Boot's original 52 MHz limit, `mmc dev 1` initialized
but a 4 KiB eMMC read failed. The SD card *did* enumerate via UMS, so the
USB path was capable of serving a disk. On the direct dongle path, the same
eMMC failure remained. A guarded SD probe showed `mmc 1` could read at 12 MHz;
`mmc 2` was unavailable. The first-block SHA-256 matched a later USB read.
These indexes and timings are observations for this unit, not every PF1007L.

### 4. Identify the eMMC disk

Wait a few seconds after loading U-Boot, then:

```sh
diskutil list external physical
diskutil info diskN
```

On this unit, the correct **whole disk** appeared as `UMS disk 0`, USB,
`Media Read-Only: Yes`, **15,758,000,128 bytes**. The disk number may change
after each reconnect. During diagnosis the 128 GB SD card appeared as a
127.9 GB UMS disk; do not mistake it for the eMMC. If macOS asks to Initialize
an unreadable disk, click **Ignore**, never Initialize.

Optional check of the first 4 KiB of *this unit*:

```sh
sudo dd if=/dev/rdiskN bs=4096 count=1 | shasum -a 256
```

It returned
`627451adbee8486b14c294ae6b00260ed91ac9cb668ec0e1495908cfa103d3cc`,
the same as the U-Boot probe written to the disposable SD. Check that `dd`
reports **4096 bytes**; a hash of empty input is not evidence. This hash is
not a universal PF1007L signature.

### 5. Back up and verify

Pass the current whole-disk identifier and exact size from `diskutil info`:

```sh
sudo python3 -I scripts/a33-frame/backup_emmc_macos.py diskN 15758000128
```

The helper rejects writable, internal, wrong-size and non-`UMS disk N` media.
It unmounts, reads the full device twice, checks SHA-256 agreement, checks the
saved image, rejects long `0xCC` filler runs, compresses it and verifies the
gzip readback. Outputs are in Git-ignored `backups/`. Keep the frame connected
until it prints `Verified full eMMC backup`. Two full reads plus compression
can take over an hour. An `.img.partial` is not a verified backup. For this
unit, the verified full-image SHA-256 is
`aa2ade8024ff98b26dddd413b037fe6ae9d40bdc68206c573ec9b2d181ce2743`.
The 15,758,000,128-byte image and the decompressed gzip both matched it.

Start the backup from the noor-frame checkout so its outputs land in
`noor-frame/backups/`. Backups may be root-owned because of `sudo`. If so, take
ownership before running checks without `sudo`:

```sh
sudo chown "$USER" backups backups/a33-emmc-full.img backups/a33-emmc-full.img.gz backups/a33-emmc-full.sha256
(cd backups && shasum -a 256 -c a33-emmc-full.sha256)
```

Keep backups private and out of Git: they hold the frame's whole storage,
including any Wi-Fi passwords it saved. Before a commit, confirm all image
variants and the checksum are excluded:

```sh
git check-ignore -v backups/a33-emmc-full.img backups/a33-emmc-full.img.gz backups/a33-emmc-full.sha256 backups/a33-emmc-full.img.partial
git status --short
```

Each backup path should report `.gitignore:...:backups/`. Never force-add a
backup image. The ignored `diagnostics/` directory also holds local build
outputs and downloaded source; commit the scripts and guide instead.

## Troubleshooting

| Symptom | Next check |
| --- | --- |
| Black screen, no A33 FEL response | Validate the data cable/dongle with another USB device; reseat the card and power-cycle. |
| Loader says `expected an A33 in FEL` | U-Boot may already be running. Power-cycle with the stub card, then query FEL. |
| USB gadget appears but no disk | Wait, inspect `diskutil`, and confirm the 12 MHz build. Do not assume the Mac or dock is the cause. |
| A 127.9 GB disk appears | That was the SD card here; eMMC was 15.8 GB. Check the loaded UMS script and disk metadata. |
| `mmc dev 1` works but its read fails | Confirm the patch contains `max-frequency = <12000000>;` for MMC2 and rebuild. |
| `dd` returns zero bytes | Recheck disk number and connection; do not suppress the error or accept an empty-input hash. |
| Backup helper rejects a disk | Reidentify it; do not bypass identity, size or write-protection checks. |

## Return to stock Android and check ADB

After the backup finishes, unplug the frame, remove the FEL card and reconnect
it. On the tested unit the AiMOR logo appeared, then the Android home screen.
The Mac no longer reported A33 FEL and saw USB vendor/product `1f3a:1000`
(`Android`). Stock ADB listed no device. On this Mac, the installed Android
platform tools are at `$HOME/Library/Android/sdk/platform-tools`:

```sh
"$HOME/Library/Android/sdk/platform-tools/adb" devices -l
```

This is a working Android
boot with USB mass storage configured, not a FEL failure.

AiMOR's Settings is its own app screen, not Android Settings. It did not offer
USB debugging on the tested unit. If a different firmware exposes Android's own
**About device → Build number**, try the [standard Android Developer options
route](https://developer.android.com/studio/debug/dev-options) before changing
eMMC. The boot ramdisk includes a `mass_storage,adb` USB action, but the stock
AiMOR UI did not provide a way to select it here.

Keep AiMOR off the home Wi-Fi during access work. The
[upstream analysis of this firmware family](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md)
reports a vendor command channel that can run shell commands as root. Verify
the exact firmware before applying any device-specific security conclusion.
Do not disconnect an active image read.

## USB ADB boot change: applied and verified on this unit

The original boot ramdisk contains `/sbin/adbd`, `ro.secure=0` and
`ro.debuggable=1`, but its active `mass_storage` USB action does not start ADB.
The [upstream mainline U-Boot procedure](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-mainline-uboot.md)
changed that single action on another PF1007L. Our offline
[`boot_patch.py`](boot_patch.py) derives the same type of change from **this
frame's own verified backup**. It does not write to the frame. The generated
payloads and plan are under ignored `diagnostics/a33-boot-patch/`.

For the tested unit, the backup's SHA-256 is
`aa2ade8024ff98b26dddd413b037fe6ae9d40bdc68206c573ec9b2d181ce2743`.
The partition table places the 32 MiB boot partition at sector **172032**;
its original SHA-256 is
`dd9070343b1f11ab599dd90f254d4e4395644c7e0d5252249ffa5de091498344`.
Do not copy these values to another frame. Parse and hash its own backup first.

```sh
python3 -I scripts/a33-frame/boot_patch.py backups/a33-emmc-full.img 172032 aa2ade8024ff98b26dddd413b037fe6ae9d40bdc68206c573ec9b2d181ce2743
cat diagnostics/a33-boot-patch/plan.json
```

The generator refuses a mismatched full-image hash, a boot sector that is not
a partition start, a bad legacy Android boot ID, a different USB action, a
ramdisk that does not fit, and existing output. It re-parses both images and
requires that exactly one CPIO file change. The header may change only in its
ramdisk-size and image-ID bytes; nothing outside the original ramdisk slot may
change. On this unit the proposed write ranges are:

| Region | Absolute 512-byte sectors, end exclusive | Bytes |
| --- | --- | ---: |
| Padded boot ramdisk | `[191844, 201324)` | 4,853,760 |
| Boot header (includes image ID) | `[172032, 172034)` | 1,024 |

The current `plan.json` SHA-256 is
`c92bd10308049d83241368e56820ab70c4c59950b7936c1c13e3386c7297824b`.
The generated `write-boot.scr` SHA-256 is
`5c00f7a60c38fa2e801072ed8b79652dd9ce40037b2a4cf4683cebefa6cc33ca`;
the `restore-boot.scr` SHA-256 is
`3d2580d434c47d1f6224d11a1eca2ba2c0eac7fdae99b0356da4730e8659cbf7`.
Its original header and ramdisk payloads were independently compared with the
verified backup, and both planned ranges stay inside the boot partition.

The script image contains a build timestamp, so its SHA-256 changes if it is
regenerated; record and review the new value before another use. The
generator also creates `restore-boot.scr` from the original bytes. U-Boot's
**USB disk** is read-only, but `mmc write` in these scripts can modify eMMC.
Do not run a write script until the plan, full backup and read-only preflight
have been reviewed and the owner has approved this specific boot change.

### Read-only preflight after any stock Android boot

Android may update `/data` during a normal boot, so a whole-disk comparison
to the earlier backup is no longer meaningful. The verifier checks **every
byte of the boot partition** against the original backup instead. Reinsert the
FEL card, power-cycle, confirm A33 FEL, then load the UMS script as in steps 2–4.
Identify the current 15,758,000,128-byte read-only UMS disk and run:

```sh
sudo python3 -I scripts/a33-frame/backup_emmc_macos.py verify-original diskN 15758000128
```

It must print `Verified: full boot partition equals the original backup.`
If it does not, stop: the saved patch plan no longer matches current eMMC.
On the tested unit this read-only preflight passed after the first stock AiMOR boot.

### Apply and verify, only after approval

Power-cycle back into FEL with the stub card. Reconfirm one A33, inspect the
plan and payload hashes, then load the four guarded payloads and write script:

```sh
P=diagnostics/a33-boot-patch
diagnostics/sunxi-tools/sunxi-fel -v uboot diagnostics/a33-uboot-out/u-boot-sunxi-with-spl.bin \
  write 0x50000000 "$P/orig-header.bin" write 0x51000000 "$P/orig-ramdisk.bin" \
  write 0x52000000 "$P/new-header.bin"  write 0x53000000 "$P/new-ramdisk.bin" \
  write 0x43100000 "$P/write-boot.scr"
```

The U-Boot script checks that eMMC reads succeed, checks CRC-32 of all four
RAM payloads, compares both original eMMC ranges byte-for-byte, writes the
ramdisk first, reads it back, and writes the header last. It then exposes eMMC
as read-only UMS. **A USB gadget appearing is not proof that the write ran.**
Identify the UMS disk again and verify the entire boot partition:

```sh
sudo python3 -I scripts/a33-frame/backup_emmc_macos.py verify diskN 15758000128
```

Only after that prints `Verified: full boot partition equals backup plus
exactly the planned patch.` should the FEL card be removed and Android booted.
This full boot-partition verification **passed on the tested unit** immediately
after the approved write; no other boot-partition bytes differed.
The expected USB identity is `1f3a:1002`; then check `adb devices -l` and
`adb -d shell id`. Confirm firmware and boot completion before installing an
app. If verification fails, keep the FEL card and original backup: do not
boot Android or retry a write blindly.

The tested unit subsequently booted AiMOR with USB `1f3a:1002`. The host's ADB
listed it as `device`, and `adb -d shell id` returned `uid=0(root)` without
`su` or an `adb root` restart. The observed Android properties were:

| Property | Value |
| --- | --- |
| `ro.product.model` | `AEEZO` |
| `ro.product.cpu.abi` | `armeabi-v7a` |
| `ro.build.version.release` / SDK | `6.0.1` / `23` |
| `ro.build.fingerprint` | `AEEZO/astar_m86_8723cs/astar-m86_8723cs:6.0.1/MOB30R/20260519:eng/test-keys` |
| `sys.boot_completed` | `1` |
| SELinux | `Disabled` |
| Stock WebView | `44.0.2403.119` |
| AiMOR app | `com.efercro.os.aimor` 6.0.78 (code 78) |

`sys.usb.config` still reports `mass_storage`; the patched USB action adds
ADB to the actual USB functions while preserving that Android property.
The exact USB serial number is intentionally kept out of this public guide.
The AiMOR APK SHA-256 is
`abc4e274940e21729de7b9dbaf1f7969efdf427955d0c4881a319611942fb65d`,
matching the APK in the upstream security analysis; its optimized code was
not separately compared. The Noor Android kiosk APK is installed as a user app;
see the [kiosk guide](../../apps/kiosk-android/README.md) for the rendering and
Home setup status.

To restore **an exactly verified patched boot partition**, power-cycle into
FEL and load the same four payloads with `restore-boot.scr` at `0x43100000`:

```sh
P=diagnostics/a33-boot-patch
diagnostics/sunxi-tools/sunxi-fel -v uboot diagnostics/a33-uboot-out/u-boot-sunxi-with-spl.bin \
  write 0x50000000 "$P/orig-header.bin" write 0x51000000 "$P/orig-ramdisk.bin" \
  write 0x52000000 "$P/new-header.bin"  write 0x53000000 "$P/new-ramdisk.bin" \
  write 0x43100000 "$P/restore-boot.scr"
sudo python3 -I scripts/a33-frame/backup_emmc_macos.py verify-original diskN 15758000128
```

Identify `diskN` again before the verification command. A partial or unknown
state needs fresh analysis before any restore; the guarded restore script
intentionally refuses it.

## Sources

- [linux-sunxi FEL SD card method](https://linux-sunxi.org/FEL#Through_a_special_SD_card_image)
- [Wes Bos's PF1007L research](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-pf1007l.md)
- [Boot access notes](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-boot-access.md)
- [Mainline U-Boot notes](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-mainline-uboot.md)
