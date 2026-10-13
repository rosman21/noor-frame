import gzip
import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("boot_patch.py")
SPEC = importlib.util.spec_from_file_location("boot_patch", SCRIPT)
boot_patch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(boot_patch)


def cpio_record(name, data):
    fields = (1, 0o100644, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(name) + 1, 0)
    header = b"070701" + b"".join(f"{field:08X}".encode() for field in fields)
    entry = header + name + b"\0"
    entry += bytes(-len(entry) % 4)
    entry += data
    return entry + bytes(-len(entry) % 4)


def sample_boot():
    cpio = (cpio_record(b"init.sun8i.usb.rc", boot_patch.OLD_ACTION)
            + cpio_record(b"TRAILER!!!", b""))
    ramdisk = gzip.compress(cpio, mtime=0)
    kernel = b"sample kernel"
    page = 2048
    padded = lambda n: (n + page - 1) // page * page
    boot = bytearray(page + padded(len(kernel)) + padded(len(ramdisk)) + page)
    struct.pack_into("<8s8I", boot, 0, b"ANDROID!", len(kernel), 0,
                     len(ramdisk), 0, 0, 0, 0, page)
    boot[page:page + len(kernel)] = kernel
    ramdisk_offset = page + padded(len(kernel))
    boot[ramdisk_offset:ramdisk_offset + len(ramdisk)] = ramdisk
    digest = hashlib.sha1()
    for part in (kernel, ramdisk, b""):
        digest.update(part)
        digest.update(struct.pack("<I", len(part)))
    boot[576:596] = digest.digest()
    return bytes(boot)


class BootPatchTests(unittest.TestCase):
    def test_only_usb_init_action_changes(self):
        original = sample_boot()
        patched, offset, slot = boot_patch.build(original)
        self.assertEqual(boot_patch.verify(original, patched, offset, slot), 2)
        self.assertEqual(original[offset + slot:], patched[offset + slot:])
        _, _, _, cpio = boot_patch.parse_boot(patched)
        records, _ = boot_patch.cpio_records(cpio)
        self.assertEqual(records[0][3].count(boot_patch.NEW_ACTION), 1)

    def test_wrong_full_image_hash_never_creates_payloads(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            image = folder / "image.img"
            image.write_bytes(sample_boot())
            output = folder / "payloads"
            with (patch.object(boot_patch, "OUT", output),
                  patch.object(boot_patch.sys, "argv", ["boot_patch.py", str(image), "1", "0" * 64])):
                with self.assertRaises(SystemExit):
                    boot_patch.main()
            self.assertFalse(output.exists())

    def test_generated_script_guards_reads_and_checks_ramdisk_before_header(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            raw = bytearray(33 * 512)
            raw[510:512] = b"\x55\xaa"
            raw[450] = 0x83
            struct.pack_into("<II", raw, 454, 1, 32)
            boot = sample_boot()
            raw[512:512 + len(boot)] = boot
            image = folder / "image.img"
            image.write_bytes(raw)
            output = folder / "payloads"
            digest = hashlib.sha256(raw).hexdigest()
            with (patch.object(boot_patch, "OUT", output),
                  patch.object(boot_patch.sys, "argv", ["boot_patch.py", str(image), "1", digest])):
                boot_patch.main()
            plan = json.loads((output / "plan.json").read_text())
            self.assertEqual(plan["full_image_sha256"], digest)
            script = (output / "write-boot.cmd").read_text()
            self.assertIn("if mmc dev 1 && mmc read", script)
            self.assertLess(script.index("mmc write 0x53000000"), script.index("mmc write 0x52000000"))
            self.assertIn("&& mmc read 0x55000000", script)
            self.assertIn("&& cmp.b 0x53000000", script)


if __name__ == "__main__":
    unittest.main()
