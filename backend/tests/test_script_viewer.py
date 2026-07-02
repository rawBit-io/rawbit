"""Tests for the Script Viewer reference disassembler (calc_functions.script_viewer)."""

import json
from pathlib import Path

import pytest

from calc_functions.calc_func import (
    script_viewer,
    _script_opcode_name_by_byte,
)

# MAX_SCRIPT_SIZE = 10,000 bytes = 20,000 hex chars (kept local to
# script_viewer so Show Code stays self-contained; asserted by value here).
_MAX_SCRIPT_BYTES = 10_000

_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "lib"
    / "__fixtures__"
    / "opcodeNameByByte.json"
)


def test_opcode_name_map_matches_shared_fixture():
    """Locks the Python byte->name map to the same fixture the TS test uses."""
    fixture = json.loads(_FIXTURE.read_text())
    py_map = {f"{b:02x}": name for b, name in _script_opcode_name_by_byte().items()}
    assert py_map == fixture


def test_map_excludes_template_aliases_but_keeps_canonical():
    m = _script_opcode_name_by_byte()
    assert m[0x00] == "OP_0"  # not "OP_0 / OP_FALSE"
    assert m[0x51] == "OP_1"  # not "OP_1 / OP_TRUE"
    assert m[0x87] == "OP_EQUAL"  # not the P2SH_SUFFIX template alias
    assert m[0x6A] == "OP_RETURN"  # not OP_RETURN_PREFIX
    assert m[0x7E] == "OP_CAT"  # disabled opcode is still named


def test_htlc_redeemscript_disassembly():
    h32 = "aa" * 32
    pk = "02" + "bb" * 32
    hexs = (
        "63a820" + h32 + "88" + "21" + pk + "ac"
        + "67" + "04" + "a721316a" + "b1" + "75" + "21" + pk + "ac" + "68"
    )
    assert script_viewer(hexs) == (
        "OP_IF\n"
        "    OP_SHA256\n"
        f"    PUSH(32) {h32}\n"
        "    OP_EQUALVERIFY\n"
        f"    PUSH(33) {pk}\n"
        "    OP_CHECKSIG\n"
        "OP_ELSE\n"
        "    PUSH(4) a721316a\n"
        "    OP_CHECKLOCKTIMEVERIFY\n"
        "    OP_DROP\n"
        f"    PUSH(33) {pk}\n"
        "    OP_CHECKSIG\n"
        "OP_ENDIF"
    )


def test_pushdata_variants_and_zero_length():
    # Wrong-size PUSHDATA forms carry the MINIMALDATA marker.
    assert script_viewer("4c04deadbeef") == "OP_PUSHDATA1(4) deadbeef · non-minimal"
    assert script_viewer("4d0200dead") == "OP_PUSHDATA2(2) dead · non-minimal"
    assert script_viewer("4e04000000deadbeef") == "OP_PUSHDATA4(4) deadbeef · non-minimal"
    assert script_viewer("4c00") == "OP_PUSHDATA1(0) (empty) · non-minimal"


def test_minimal_push_rules():
    # Minimal direct push: no marker.
    assert script_viewer("04deadbeef") == "PUSH(4) deadbeef"
    # 1-byte small ints / 0x81 must use OP_N / OP_1NEGATE.
    assert script_viewer("0105") == "PUSH(1) 05 · non-minimal"
    assert script_viewer("0181") == "PUSH(1) 81 · non-minimal"
    assert script_viewer("01ff") == "PUSH(1) ff"
    # Correctly-sized PUSHDATA forms are minimal.
    assert script_viewer("4c4c" + "ab" * 76) == "OP_PUSHDATA1(76) " + "ab" * 76
    assert script_viewer("4d0001" + "cd" * 256) == "OP_PUSHDATA2(256) " + "cd" * 256


def test_small_ints_and_disabled_named():
    assert script_viewer("005160") == "OP_0\nOP_1\nOP_16"
    assert script_viewer("7e95628450") == (
        "OP_CAT\nOP_MUL\nOP_VER\nOP_AND\nOP_RESERVED"
    )
    assert script_viewer("bb") == "UNKNOWN_0xbb"


def test_whitespace_and_case_normalization():
    assert script_viewer(" 63\n A8\t68 ") == "OP_IF\n    OP_SHA256\nOP_ENDIF"


def test_unbalanced_control_flow_warning():
    assert script_viewer("6351").endswith("# warning: unbalanced OP_IF/OP_ENDIF — missing OP_ENDIF")
    assert "without a matching OP_IF" in script_viewer("68")


@pytest.mark.parametrize(
    "bad,needle",
    [
        ("zz", "Not valid hex"),
        ("abc", "Odd-length"),
        ("0401", "Truncated push"),
        ("4c", "Truncated OP_PUSHDATA1 length prefix"),
        ("4d0400dead", "OP_PUSHDATA2"),
    ],
)
def test_error_paths(bad, needle):
    with pytest.raises(ValueError) as exc:
        script_viewer(bad)
    assert needle in str(exc.value)
    assert "undefined" not in str(exc.value)


def test_size_cap():
    with pytest.raises(ValueError, match="too large"):
        script_viewer("00" * (_MAX_SCRIPT_BYTES + 1))
    # exactly at the limit is accepted (all OP_0)
    at_limit = script_viewer("00" * _MAX_SCRIPT_BYTES)
    assert at_limit.count("OP_0") == _MAX_SCRIPT_BYTES


def test_non_string_and_empty_inputs_do_not_crash():
    # Coerced, never AttributeError.
    assert script_viewer(None) == ""
    assert script_viewer("") == ""
    with pytest.raises(ValueError):
        script_viewer(123)  # str(123) = "123" -> odd-length hex error, not a crash
