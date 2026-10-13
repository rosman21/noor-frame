#!/usr/bin/env python3
"""Back up or verify the PF1007L eMMC through read-only U-Boot UMS (macOS).

Usage (run from the repository root, with sudo):
  sudo python3 -I scripts/a33-frame/backup_emmc_macos.py diskN <exact-bytes>
  sudo python3 -I scripts/a33-frame/backup_emmc_macos.py verify diskN <exact-bytes>
  sudo python3 -I scripts/a33-frame/backup_emmc_macos.py verify-original diskN <exact-bytes>

<exact-bytes> is the eMMC size from `diskutil info diskN` (Disk Size, in bytes). It
guards against a disk number that changed after a replug. The script refuses a disk
that macOS reports as writable: only the read-only U-Boot build should be running.

The script reads the whole disk to backups/a33-emmc-full.img, re-reads it
independently, rejects 0xCC filler, gzips it and verifies the gzip readback.
The verify actions compare the whole boot partition with the original image,
allowing only the guarded patch payloads in plan.json for `verify`. Android may
change /data during a normal boot, so a whole-disk comparison is not valid.
"""

import gzip
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKUPS = REPO / "backups"
IMAGE = BACKUPS / "a33-emmc-full.img"
PARTIAL = BACKUPS / "a33-emmc-full.img.partial"
GZIP_PATH = BACKUPS / "a33-emmc-full.img.gz"
HASH_PATH = BACKUPS / "a33-emmc-full.sha256"
PLAN = REPO / "diagnostics/a33-boot-patch/plan.json"
SECTOR = 512
CHUNK = 4 * 1024 * 1024
FILLER_RUN = 4096


def fail(message):
    sys.exit(f"STOP: {message}")


def open_disk(identifier, expected_size):
    if not re.fullmatch(r"disk\d+", identifier):
        fail("pass a whole disk like disk4, not a partition")
    info = plistlib.loads(subprocess.check_output(["diskutil", "info", "-plist", identifier]))
    if not re.fullmatch(r"UMS disk \d+", info.get("MediaName", "")):
        fail(f"unexpected media name {info.get('MediaName')!r}; expected U-Boot's 'UMS disk N'")
    if info.get("TotalSize") != expected_size:
        fail(f"size {info.get('TotalSize')} != expected {expected_size}")
    if info.get("Internal", True) or info.get("BusProtocol") != "USB":
        fail("not an external USB disk")
    if info.get("WritableMedia", True):
        fail("disk is writable; the read-only U-Boot build is not the one running")
    subprocess.check_call(["diskutil", "unmountDisk", identifier])
    return f"/dev/r{identifier}"


def chunks(path, total, label):
    done, started = 0, time.time()
    with open(path, "rb", buffering=0) as source:
        while done < total:
            block = source.read(min(CHUNK, total - done))
            if not block:
                fail(f"short read at byte {done}")
            yield done, block
            done += len(block)
            rate = done / max(time.time() - started, 0.001) / 1e6
            print(f"\r  {label}: {done * 100 // total:3d}%  {rate:5.1f} MB/s", end="", flush=True)
    print()


def backup(raw_path, size):
    for path in (PARTIAL, IMAGE, GZIP_PATH):
        if path.exists():
            fail(f"{path.name} already exists; refusing to overwrite")
    BACKUPS.mkdir(exist_ok=True)
    os.umask(0o077)

    first, filler = hashlib.sha256(), 0
    with open(PARTIAL, "xb") as out:
        for _, block in chunks(raw_path, size, "pass 1 (copy)"):
            first.update(block)
            out.write(block)
            filler += block.count(b"\xcc" * FILLER_RUN)
    print(f"  pass 1 SHA-256: {first.hexdigest()}  (0xCC runs: {filler})")
    if filler:
        fail("0xCC filler found; this may not be real flash data")

    second = hashlib.sha256()
    for _, block in chunks(raw_path, size, "pass 2 (re-read)"):
        second.update(block)
    if second.hexdigest() != first.hexdigest():
        fail("independent re-read differs")

    stored = hashlib.sha256()
    for _, block in chunks(PARTIAL, size, "image file"):
        stored.update(block)
    if stored.hexdigest() != first.hexdigest():
        fail("image file differs from the disk")

    print("  compressing...")
    with open(PARTIAL, "rb") as source, gzip.open(GZIP_PATH, "xb", compresslevel=6) as target:
        shutil.copyfileobj(source, target, CHUNK)
    readback = hashlib.sha256()
    with gzip.open(GZIP_PATH, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            readback.update(block)
    if readback.hexdigest() != first.hexdigest():
        fail("gzip readback differs")

    PARTIAL.rename(IMAGE)
    (BACKUPS / "a33-emmc-full.sha256").write_text(f"{first.hexdigest()}  {IMAGE.name}\n")
    print(f"Verified full eMMC backup: {IMAGE} ({size} bytes), SHA-256 {first.hexdigest()}")


def load_patches(size):
    plan = json.loads(PLAN.read_text())
    boot_start = plan["boot_partition_sector"] * SECTOR
    boot_size = plan["boot_partition_sectors"] * SECTOR
    if boot_start < 0 or boot_size <= 0 or boot_start + boot_size > size:
        fail("boot partition is outside the disk")
    if [entry["file"] for entry in plan["writes"]] != ["new-ramdisk.bin", "new-header.bin"]:
        fail("unexpected patch payload list")
    patches = []
    for entry in plan["writes"]:
        name = entry["file"][:-4].replace("-", "_")
        data = (PLAN.parent / entry["file"]).read_bytes()
        offset = entry["sector"] * SECTOR
        if entry["sectors"] <= 0 or offset < boot_start or offset + len(data) > boot_start + boot_size:
            fail(f"{entry['file']} is outside the boot partition")
        if len(data) != entry["sectors"] * SECTOR:
            fail(f"{entry['file']} has the wrong length")
        if hashlib.sha256(data).hexdigest() != plan["sha256"][name]:
            fail(f"{entry['file']} SHA-256 mismatch")
        if f"{zlib.crc32(data):08x}" != plan["crc32"][name]:
            fail(f"{entry['file']} CRC-32 mismatch")
        patches.append((offset, data))
    if patches[1][0] < patches[0][0] + len(patches[0][1]) and patches[0][0] < patches[1][0] + len(patches[1][1]):
        fail("patch ranges overlap")
    if HASH_PATH.read_text().split()[0] != plan["full_image_sha256"]:
        fail("plan does not match the verified full-image checksum")
    return plan, patches


def verify(raw_path, size, patched=True):
    if IMAGE.stat().st_size != size:
        fail("backup image size differs from the disk")
    plan, all_patches = load_patches(size)
    patches = all_patches if patched else []
    boot_start = plan["boot_partition_sector"] * SECTOR
    boot_size = plan["boot_partition_sectors"] * SECTOR
    original_hash = hashlib.sha256()
    with IMAGE.open("rb") as saved, open(raw_path, "rb", buffering=0) as disk:
        saved.seek(boot_start)
        disk.seek(boot_start)
        for relative in range(0, boot_size, CHUNK):
            offset = boot_start + relative
            count = min(CHUNK, boot_size - relative)
            got = disk.read(count)
            original = saved.read(count)
            if len(got) != count:
                fail("short read from eMMC boot partition")
            if len(original) != len(got):
                fail("short read from backup image")
            original_hash.update(original)
            want = bytearray(original)
            for start, data in patches:
                lo, hi = max(start, offset), min(start + len(data), offset + len(got))
                if lo < hi:
                    want[lo - offset:hi - offset] = data[lo - start:hi - start]
            if got != want:
                fail(f"boot partition differs from expected image at byte offset {offset}")
    if original_hash.hexdigest() != plan["boot_partition_sha256"]:
        fail("original backup boot-partition SHA-256 mismatch")
    print("Verified: full boot partition equals backup plus exactly the planned patch." if patched
          else "Verified: full boot partition equals the original backup.")


def main():
    if len(sys.argv) == 3:
        action, identifier, size = "backup", sys.argv[1], int(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] in ("verify", "verify-original"):
        action, identifier, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
    else:
        sys.exit(__doc__)
    if os.geteuid() != 0:
        fail("run with sudo")
    raw_path = open_disk(identifier, size)
    if action == "backup":
        backup(raw_path, size)
    else:
        verify(raw_path, size, action == "verify")


if __name__ == "__main__":
    main()
