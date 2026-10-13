import importlib.util
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("fel_card_macos.py")
SPEC = importlib.util.spec_from_file_location("fel_card_macos", SCRIPT)
fel_card = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fel_card)


def mbr(partition_type, start_sector):
    prefix = bytearray(fel_card.PREFIX_SIZE)
    prefix[510:512] = b"\x55\xaa"
    prefix[450] = partition_type
    struct.pack_into("<I", prefix, 454, start_sector)
    return bytes(prefix)


class FelCardTests(unittest.TestCase):
    def test_disk_guard_rejects_partition_and_malformed_name(self):
        for identifier in ("disk4s1", "diskfoo"):
            with self.subTest(identifier=identifier):
                with self.assertRaises(SystemExit):
                    fel_card.check_card(identifier, 4096)

    def test_layout_accepts_partition_after_stub(self):
        fel_card.check_layout(mbr(0x07, 8192))

    def test_layout_rejects_gpt_or_early_partition(self):
        for partition_type, start in ((0xEE, 8192), (0x07, 2048)):
            with self.subTest(partition_type=partition_type, start=start):
                with self.assertRaises(SystemExit):
                    fel_card.check_layout(mbr(partition_type, start))

    def test_write_checks_backup_and_exact_region(self):
        before = mbr(0x07, 8192)
        stub = b"stub".ljust(fel_card.STUB_SIZE, b"x")
        with tempfile.TemporaryDirectory() as temp_dir:
            raw = Path(temp_dir) / "card.bin"
            raw.write_bytes(before)
            with (
                patch.object(fel_card, "load_stub", return_value=stub),
                patch.object(fel_card, "load_backup", return_value=before),
            ):
                fel_card.write(raw)
            expected = before[:fel_card.STUB_OFFSET] + stub + before[fel_card.STUB_OFFSET + fel_card.STUB_SIZE:]
            self.assertEqual(raw.read_bytes(), expected)


if __name__ == "__main__":
    unittest.main()
