import inspect
import pytest

pytest.importorskip("bitcointx")
pytest.importorskip("secp256k1")

from backend.codeview_expander import expand_function_source
from backend.calc_functions import calc_func as calc_ops


def test_expand_function_source_no_helpers_returns_original():
    src = "def simple():\n    return 'ok'"
    assert expand_function_source(None, src) == src


def test_expand_function_source_includes_helper_blocks():
    func = calc_ops.address_to_scriptpubkey
    source = inspect.getsource(func)

    expanded = expand_function_source(func, source)

    assert "Expanded view" in expanded
    assert "Base58 / Base58Check helpers" in expanded
    assert "Bech32 / Bech32m helpers" in expanded
    assert "def _b58check_decode" in expanded
    assert "def _bech32_decode" in expanded
    assert "# --- Node function ---" in expanded
    assert "def address_to_scriptpubkey" in expanded


def test_expand_function_source_inlines_musig2_local_helper():
    func = calc_ops.musig2_aggregate_pubkeys
    source = inspect.getsource(func)

    expanded = expand_function_source(func, source)

    assert "Expanded view" in expanded
    assert "Local helper functions" in expanded
    assert "def _musig2_keyagg_details" in expanded
    assert "# --- Node function ---" in expanded
    assert "def musig2_aggregate_pubkeys" in expanded


def test_expand_function_source_dedupes_helper_definitions():
    func = calc_ops.address_to_scriptpubkey
    source = inspect.getsource(func)

    expanded = expand_function_source(func, source)

    # Bundle helpers should appear exactly once even with generic expansion enabled.
    assert expanded.count("def _b58check_decode") == 1
    assert expanded.count("def _bech32_decode") == 1


def test_expand_function_source_includes_bip39_wordlist():
    func = calc_ops.entropy_to_bip39_mnemonic
    source = inspect.getsource(func)

    expanded = expand_function_source(func, source)

    assert "BIP39 English wordlist" in expanded
    assert "_BIP39_ENGLISH_WORDLIST = [" in expanded
    assert '    "abandon",' in expanded
    assert '    "zoo",' in expanded
    assert "_BIP39_ENGLISH_INDEX" in expanded
    assert "# --- Node function ---" in expanded
    assert "def entropy_to_bip39_mnemonic" in expanded


def test_expand_function_source_includes_manual_bip39_seed_helpers():
    func = calc_ops.bip39_mnemonic_to_seed
    source = inspect.getsource(func)

    expanded = expand_function_source(func, source)

    assert "BIP39 English wordlist" in expanded
    assert "def _bip39_mnemonic_to_entropy" in expanded
    assert "def _hmac_sha512" in expanded
    assert "def _pbkdf2_hmac_sha512" in expanded
    assert "hashlib.pbkdf2_hmac" not in expanded
    assert "def bip39_mnemonic_to_seed" in expanded


def test_expand_function_source_includes_opcode_sequence_conversion():
    func = calc_ops.op_code_select
    source = inspect.getsource(func)

    expanded = expand_function_source(func, source)

    assert "Opcode sequence conversion" in expanded
    assert "OPCODE_TO_HEX = {" in expanded
    assert "'OP_DUP': '76'" in expanded
    assert "'OP_HASH160': 'a9'" in expanded
    assert "def _ordered_values" in expanded
    assert "def opcode_sequence_to_hex" in expanded
    assert "# --- Node function ---" in expanded
    assert "def op_code_select" in expanded
