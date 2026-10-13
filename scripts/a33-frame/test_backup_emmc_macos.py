import gzip
import hashlib
import importlib.util
import json
import plistlib
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("backup_emmc_macos.py")
SPEC = importlib.util.spec_from_file_location("backup_emmc_macos", SCRIPT)
backup_emmc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup_emmc)


class BackupEmmcTests(unittest.TestCase):
    def test_disk_guard_rejects_writable_media(self):
        info = {
            "MediaName": "UMS disk 0",
            "TotalSize": 4096,
            "Internal": False,
            "BusProtocol": "USB",
            "WritableMedia": True,
        }
        with patch.object(backup_emmc.subprocess, "check_output", return_value=plistlib.dumps(info)):
            with patch.object(backup_emmc.subprocess, "check_call") as unmount:
                with self.assertRaises(SystemExit):
                    backup_emmc.open_disk("disk4", 4096)
                unmount.assert_not_called()

    def test_backup_is_independently_read_and_verified(self):
        data = (bytes(range(256)) * 32)
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            raw = folder / "device.bin"
            raw.write_bytes(data)
            with (
                patch.object(backup_emmc, "BACKUPS", folder),
                patch.object(backup_emmc, "IMAGE", folder / "a33-emmc-full.img"),
                patch.object(backup_emmc, "PARTIAL", folder / "a33-emmc-full.img.partial"),
                patch.object(backup_emmc, "GZIP_PATH", folder / "a33-emmc-full.img.gz"),
                patch.object(backup_emmc, "CHUNK", 1024),
            ):
                backup_emmc.backup(raw, len(data))
                self.assertEqual((folder / "a33-emmc-full.img").read_bytes(), data)
                with gzip.open(folder / "a33-emmc-full.img.gz", "rb") as compressed:
                    self.assertEqual(compressed.read(), data)
                self.assertIn(hashlib.sha256(data).hexdigest(),
                              (folder / "a33-emmc-full.sha256").read_text())

    def test_verify_allows_only_planned_payloads(self):
        original = bytes(range(256)) * 32
        ramdisk = b"R" * 512
        header = b"H" * 512
        actual = bytearray(original)
        actual[2048:2560] = ramdisk
        actual[512:1024] = header
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            image = folder / "a33-emmc-full.img"
            raw = folder / "device.bin"
            plan_path = folder / "plan.json"
            image.write_bytes(original)
            raw.write_bytes(actual)
            (folder / "new-ramdisk.bin").write_bytes(ramdisk)
            (folder / "new-header.bin").write_bytes(header)
            payloads = {"new_ramdisk": ramdisk, "new_header": header}
            plan_path.write_text(json.dumps({
                "full_image_sha256": hashlib.sha256(original).hexdigest(),
                "boot_partition_sha256": hashlib.sha256(original[512:6656]).hexdigest(),
                "boot_partition_sector": 1,
                "boot_partition_sectors": 12,
                "writes": [{"sector": 4, "sectors": 1, "file": "new-ramdisk.bin"},
                           {"sector": 1, "sectors": 1, "file": "new-header.bin"}],
                "sha256": {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()},
                "crc32": {name: f"{zlib.crc32(data):08x}" for name, data in payloads.items()},
            }))
            with (patch.object(backup_emmc, "IMAGE", image),
                  patch.object(backup_emmc, "PLAN", plan_path),
                  patch.object(backup_emmc, "HASH_PATH", folder / "a33-emmc-full.sha256"),
                  patch.object(backup_emmc, "CHUNK", 1024)):
                (folder / "a33-emmc-full.sha256").write_text(f"{hashlib.sha256(original).hexdigest()}  a33-emmc-full.img\n")
                backup_emmc.verify(raw, len(original))
                actual[7000] ^= 1  # Android may change data outside the boot partition.
                raw.write_bytes(actual)
                backup_emmc.verify(raw, len(original))
                actual[3072] ^= 1
                raw.write_bytes(actual)
                with self.assertRaises(SystemExit):
                    backup_emmc.verify(raw, len(original))


if __name__ == "__main__":
    unittest.main()
