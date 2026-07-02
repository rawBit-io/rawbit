"""Tests for the Script Viewer reference disassembler (calc_functions.script_viewer)."""

import json
from pathlib import Path

import pytest

from calc_functions.calc_func import (
    script_viewer,
    _script_opcode_name_by_byte,
    _SCRIPT_VIEWER_MAX_HEX_CHARS,
)

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
        f"    {h32}\n"
        "    OP_EQUALVERIFY\n"
        f"    {pk}\n"
        "    OP_CHECKSIG\n"
        "OP_ELSE\n"
        "    a721316a\n"
        "    OP_CHECKLOCKTIMEVERIFY\n"
        "    OP_DROP\n"
        f"    {pk}\n"
        "    OP_CHECKSIG\n"
        "OP_ENDIF"
    )


def test_pushdata_variants_and_zero_length():
    assert script_viewer("4c04deadbeef") == "deadbeef"
    assert script_viewer("4d0200dead") == "dead"
    assert script_viewer("4e04000000deadbeef") == "deadbeef"
    assert script_viewer("4c00") == "(empty)"


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
    too_big = "00" * (_SCRIPT_VIEWER_MAX_HEX_CHARS // 2 + 1)
    with pytest.raises(ValueError) as exc:
        script_viewer(too_big)
    assert "too large" in str(exc.value)


def test_non_string_and_empty_inputs_do_not_crash():
    # Coerced, never AttributeError.
    assert script_viewer(None) == ""
    assert script_viewer("") == ""
    with pytest.raises(ValueError):
        script_viewer(123)  # str(123) = "123" -> odd-length hex error, not a crash
