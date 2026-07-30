import binascii
import concurrent.futures
import hashlib
import json
from decimal import Decimal

import pytest
from ecdsa import SigningKey
from ecdsa.util import sigencode_der_canonize

pytest.importorskip("hypothesis")
from hypothesis import given, strategies as st

pytest.importorskip("bitcointx")
pytest.importorskip("secp256k1")
pytest.importorskip("ecdsa")

from backend.calc_functions import calc_func as calc
from bitcointx.core import (
    CMutableTransaction,
    CMutableTxIn,
    CMutableTxOut,
    COutPoint,
    CTxInWitness,
    b2x,
)
from bitcointx.core.script import CScript, CScriptWitness, SignatureHashSchnorr
import secp256k1

SAMPLE_PRIV_KEY = "01".rjust(64, "0")
SAMPLE_MSG_HASH = "0f" * 32
SAMPLE_SIGNATURE = (
    "304402203b553accbd4b08f905b299be1ca40ea106148218d3a52f0972908276697248ce"
    "02207254bbdbbe0717a1c52882066b4c0080322a1e12ff7adaa872fba02659ea6c91"
)
SAMPLE_TX_HEX = (
    "02000000010000000000000000000000000000000000000000000000000000000000000000000000000151"
    "ffffffff01e803000000000000015100000000"
)
GENESIS_HASH160 = "62e907b15cbf27d5425399ebf6f0fb50ebb88f18"
PREVIOUS_RAW_TX = (
    "02000000000101d507b1bbe380ffdb19e008044763322ef974a5def6323e867c8344fbdd44ba0401000000"
    "00fdffffff0214e30100000000001976a914e9d2d6d73db62c723c4287e5e834ab9135c2998588ace388eb"
    "a4000000001976a914276b47b67aec2db91331c9c3299caa9b4398c48188ac0247304402201fc2aef6b3"
    "6785ffdeb35ac71487d8c1d7378a2b01e25568ec2c49adb7600a97022024fa274727801d799eec818a"
    "e70128f17ed3bd959ae9c4345653b55a7d1bdfd5012102f11acd891cc230c38c004038a037bd2139ee"
    "74aaaf38875b7b09ee73f6c6c02416040200"
)
PREVIOUS_TXID = "91d3b05d5112933301b0ce9a5a731b854f28b5a00d2205a631034983e970f7b1"
PREVIOUS_TXID_REVERSED = "b1f770e983490331a605220da0b5284f851b735a9aceb001339312515db0d391"


def build_sample_tx_hex() -> str:
    prev_txid = bytes.fromhex("00" * 32)
    outpoint = COutPoint(prev_txid, 0)
    tx_in = CMutableTxIn(outpoint, CScript([1]), 0xFFFFFFFF)
    tx_out = CMutableTxOut(1000, CScript([1]))
    tx = CMutableTransaction(vin=[tx_in], vout=[tx_out])
    return b2x(tx.serialize())


def build_tx_with_op_returns() -> str:
    prev_txid = bytes.fromhex("00" * 32)
    tx_in = CMutableTxIn(COutPoint(prev_txid, 0), CScript([1]), 0xFFFFFFFF)
    hello = bytes.fromhex("48656c6c6f")
    long_payload = b"\xff" * 80
    tx = CMutableTransaction(
        vin=[tx_in],
        vout=[
            CMutableTxOut(1000, CScript([1])),
            CMutableTxOut(0, CScript(bytes([0x6A, len(hello)]) + hello)),
            CMutableTxOut(
                0,
                CScript(bytes([0x6A, 0x4C, len(long_payload)]) + long_payload),
            ),
        ],
    )
    return b2x(tx.serialize())


def build_p2wsh_op_true_tx():
    witness_script = CScript([1])
    wsh = hashlib.sha256(bytes(witness_script)).hexdigest()
    script_pubkey_hex = "0020" + wsh

    txin = CMutableTxIn(COutPoint(b"\x00" * 32, 0))
    txout = CMutableTxOut(0, CScript([0]))
    tx = CMutableTransaction(vin=[txin], vout=[txout])

    witness = CTxInWitness(scriptWitness=CScriptWitness([bytes(witness_script)]))
    tx.wit.vtxinwit = (witness,)

    return tx, script_pubkey_hex, witness_script


@pytest.mark.parametrize(
    "payload, expected",
    [
        (b"\x00", "1"),
        (bytes.fromhex("0062e907b15cbf27d5425399ebf6f0fb50ebb88f18"), None),
    ],
)
def test_b58_roundtrip(payload, expected):
    encoded = calc._b58encode(payload)
    assert calc._b58decode(encoded) == payload
    if expected is not None:
        assert encoded == expected


def test_b58check_roundtrip_known_value():
    payload = bytes.fromhex("0062e907b15cbf27d5425399ebf6f0fb50ebb88f18")
    encoded = calc._b58check_encode(payload)
    assert encoded == "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    assert calc._b58check_decode(encoded) == payload


def test_b58decode_rejects_invalid_characters():
    with pytest.raises(ValueError, match="Invalid Base58 character: '0'"):
        calc._b58decode("10")


def test_bech32_helpers():
    assert calc._bech32_hrp_expand("bc") == [3, 3, 0, 2, 3]
    assert calc._bech32_polymod([0, 1, 2, 3, 4]) == 33589348
    checksum = calc._bech32_create_checksum("bc", [0, 14, 20], 1)
    assert checksum == [26, 22, 26, 8, 30, 22]
    assert calc._convertbits(b"\xff", 8, 5, True) == [31, 28]


def test_bech32_convertbits_invalid_padding():
    with pytest.raises(ValueError, match="invalid padding"):
        calc._convertbits([31], 5, 8, pad=False)


def test_bech32_encode_decode_roundtrip():
    program = bytes.fromhex("751e76e8199196d454941c45d1b3a323f1433bd6")
    addr = calc._bech32_encode("bc", 0, program)
    assert addr == "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    hrp, ver, decoded = calc._bech32_decode(addr)
    assert hrp == "bc"
    assert ver == 0
    assert decoded == program


def test_hrp_for_network_variants():
    assert calc._hrp_for_network("mainnet") == "bc"
    assert calc._hrp_for_network("testnet") == "tb"
    assert calc._hrp_for_network("signet") == "tb"
    assert calc._hrp_for_network("unknown") == "bcrt"


def test_secp_context_lifecycle():
    sign_ctx_first = calc._get_sign_ctx()
    sign_ctx_second = calc._get_sign_ctx()
    verify_ctx_first = calc._get_verify_ctx()
    verify_ctx_second = calc._get_verify_ctx()
    assert sign_ctx_first == sign_ctx_second
    assert verify_ctx_first == verify_ctx_second

    calc._destroy_ctxs()
    assert calc._SECP256K1_SIGN is None
    assert calc._SECP256K1_VERIFY is None
    # ensure contexts can be recreated after destruction
    assert calc._get_sign_ctx() is not None
    assert calc._get_verify_ctx() is not None


def test_deserialize_tx_cached_reuses_instance():
    tx_hex = build_sample_tx_hex()
    first = calc._deserialize_tx_cached(tx_hex)
    second = calc._deserialize_tx_cached(tx_hex)
    assert first is second


def test_deserialize_tx_cached_skips_large_transactions(monkeypatch):
    monkeypatch.setattr(calc, "_TX_CACHE_MAX_HEX_CHARS", 10)
    tx_hex = build_sample_tx_hex()
    first = calc._deserialize_tx_cached(tx_hex)
    second = calc._deserialize_tx_cached(tx_hex)
    assert first is not second


def test_tagged_hash_only_caches_known_protocol_tags():
    tag = "definitely-not-a-protocol-tag"
    data = b"\x01\x02"
    digest = calc._tagged_hash_bytes(tag, data)
    tag_hash = hashlib.sha256(tag.encode()).digest()
    assert digest == hashlib.sha256(tag_hash + tag_hash + data).digest()
    assert tag not in calc._TAG_HASH_CACHE

    calc._tagged_hash_bytes("TapTweak", data)
    assert "TapTweak" in calc._TAG_HASH_CACHE


def test_bytes_from_even_hex_valid_and_invalid():
    assert calc._bytes_from_even_hex("0x00ff", name="data") == b"\x00\xff"
    with pytest.raises(ValueError):
        calc._bytes_from_even_hex("abc", name="data")


def test_identity_and_concat_all():
    assert calc.identity("hello") == "hello"
    assert calc.concat_all(["a", 1, "b"]) == "a1b"


def test_random_256_properties():
    priv = calc.random_256()
    assert len(priv) == 64
    value = int(priv, 16)
    assert 1 <= value < 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def test_entropy_to_bip39_mnemonic_known_vectors():
    assert calc.entropy_to_bip39_mnemonic("00" * 16) == (
        "abandon abandon abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon about"
    )
    assert calc.entropy_to_bip39_mnemonic("00000000000000000000000000000001") == (
        "abandon abandon abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon actual"
    )
    assert calc.entropy_to_bip39_mnemonic("00" * 32) == (
        "abandon abandon abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon abandon abandon abandon abandon art"
    )


def test_entropy_to_bip39_mnemonic_rejects_invalid_entropy():
    with pytest.raises(ValueError, match="BIP39 entropy must be"):
        calc.entropy_to_bip39_mnemonic("00" * 15)
    with pytest.raises(ValueError, match="not valid hexadecimal"):
        calc.entropy_to_bip39_mnemonic("zz" * 16)


def test_bip39_mnemonic_to_seed_known_vector():
    mnemonic = (
        "abandon abandon abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon about"
    )
    assert calc.bip39_mnemonic_to_seed([mnemonic, "TREZOR"]) == (
        "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553"
        "1f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"
    )


def test_bip39_mnemonic_to_seed_defaults_to_empty_passphrase():
    mnemonic = (
        "abandon abandon abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon about"
    )
    assert calc.bip39_mnemonic_to_seed([mnemonic]) == calc.bip39_mnemonic_to_seed(
        [mnemonic, ""]
    )


def test_bip39_mnemonic_to_seed_rejects_invalid_mnemonic():
    with pytest.raises(ValueError, match="Mnemonic is required"):
        calc.bip39_mnemonic_to_seed([""])
    with pytest.raises(ValueError, match="Invalid BIP39 mnemonic"):
        calc.bip39_mnemonic_to_seed(["abandon " * 12])


def _xprv_private_key(xprv: str) -> str:
    payload = calc._b58check_decode(xprv)  # type: ignore[attr-defined]
    assert len(payload) == 78
    private_key_data = payload[45:]
    assert private_key_data[0] == 0
    return private_key_data[1:].hex()


def test_bip32_derive_private_key_matches_official_vectors():
    seed = "000102030405060708090a0b0c0d0e0f"
    vectors = {
        "m": "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqji"
        "ChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi",
        "m/0'": "xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1"
        "TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7",
        "m/0'/1": "xprv9wTYmMFdV23N2TdNG573QoEsfRrWKQgWeibmLntzniatZv"
        "R9BmLnvSxqu53Kw1UmYPxLgboyZQaXwTCg8MSY3H2EU4pWcQDnRnrVA1xe8fs",
        "m/0'/1/2'": "xprv9z4pot5VBttmtdRTWfWQmoH1taj2axGVzFqSb8C9xax"
        "KymcFzXBDptWmT7FwuEzG3ryjH4ktypQSAewRiNMjANTtpgP4mLTj34bhnZX7UiM",
    }
    for path, xprv in vectors.items():
        assert calc.bip32_derive_private_key([seed, path]) == _xprv_private_key(xprv)


def test_bip32_derive_private_key_accepts_hardened_suffixes():
    seed = "000102030405060708090a0b0c0d0e0f"
    expected = calc.bip32_derive_private_key([seed, "m/0'"])
    assert calc.bip32_derive_private_key([seed, "m/0h"]) == expected
    assert calc.bip32_derive_private_key([seed, "m/0H"]) == expected


def test_bip32_derive_private_key_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="BIP32 seed must be"):
        calc.bip32_derive_private_key(["00" * 15, "m"])
    with pytest.raises(ValueError, match="must start with m/"):
        calc.bip32_derive_private_key(["00" * 16, "44'/1'/0'/0/0"])
    with pytest.raises(ValueError, match="Invalid BIP32 path component"):
        calc.bip32_derive_private_key(["00" * 16, "m/not-a-number"])
    with pytest.raises(ValueError, match="less than 2\\^31"):
        calc.bip32_derive_private_key(["00" * 16, "m/2147483648"])


def _trezor_params_vals(**overrides):
    vals = {
        "0": "testnet",
        "1": "2",
        "2": "0",
        "1000": "m/44'/1'/0'/0/1",
        "1010": PREVIOUS_TXID,
        "1020": "0",
        "1030": "123668",
        "1040": "fffffffd",
        "1050": "AUTO",
        "3000": "mtAoaTyXBeksZbMtwk6yG5M1xCYUDpNNU9",
        "3010": "123000",
        "3020": "AUTO",
        "5000": PREVIOUS_RAW_TX,
    }
    vals.update(overrides)
    return vals


def test_build_trezor_sign_transaction_params_uses_dynamic_groups():
    params = json.loads(calc.build_trezor_sign_transaction_params(_trezor_params_vals()))

    assert params["coin"] == "testnet"
    assert params["version"] == 2
    assert params["locktime"] == 0
    assert params["inputs"] == [
        {
            "address_n": [2147483692, 2147483649, 2147483648, 0, 1],
            "prev_hash": PREVIOUS_TXID,
            "prev_index": 0,
            "amount": 123668,
            "sequence": 4294967293,
            "script_type": "SPENDADDRESS",
        }
    ]
    assert params["outputs"] == [
        {
            "address": "mtAoaTyXBeksZbMtwk6yG5M1xCYUDpNNU9",
            "amount": 123000,
            "script_type": "PAYTOADDRESS",
        }
    ]
    assert params["refTxs"][0]["hash"] == PREVIOUS_TXID
    assert params["refTxs"][0]["version"] == 2
    assert params["refTxs"][0]["lock_time"] == 132118
    assert params["refTxs"][0]["inputs"][0]["script_sig"] == ""
    assert params["refTxs"][0]["bin_outputs"][0] == {
        "amount": 123668,
        "script_pubkey": "76a914e9d2d6d73db62c723c4287e5e834ab9135c2998588ac",
    }


def test_build_trezor_sign_transaction_params_supports_multiple_groups():
    params = json.loads(
        calc.build_trezor_sign_transaction_params(
            _trezor_params_vals(
                **{
                    "1100": "m/84'/1'/0'/0/0",
                    "1110": PREVIOUS_TXID,
                    "1120": "1",
                    "1130": "2766899427",
                    "1140": "4294967295",
                    "1150": "AUTO",
                    "3100": "m/84'/1'/0'/1/0",
                    "3110": "2766800000",
                    "3120": "AUTO",
                }
            )
        )
    )

    assert [tx_input["script_type"] for tx_input in params["inputs"]] == [
        "SPENDADDRESS",
        "SPENDWITNESS",
    ]
    assert params["outputs"][1] == {
        "address_n": [2147483732, 2147483649, 2147483648, 1, 0],
        "amount": 2766800000,
        "script_type": "PAYTOWITNESS",
    }
    assert [ref_tx["hash"] for ref_tx in params["refTxs"]] == [PREVIOUS_TXID]


def test_build_trezor_sign_transaction_params_parses_sequence_formats():
    cases = {
        "1": 1,
        "10": 10,
        "fffffffd": 4294967293,
        "fffffffe": 4294967294,
        "ffffffff": 4294967295,
    }

    for raw_sequence, expected in cases.items():
        params = json.loads(
            calc.build_trezor_sign_transaction_params(
                _trezor_params_vals(**{"1040": raw_sequence})
            )
        )
        assert params["inputs"][0]["sequence"] == expected


def test_build_trezor_sign_transaction_params_rejects_reversed_sequence_bytes():
    with pytest.raises(ValueError, match="leading zeroes"):
        calc.build_trezor_sign_transaction_params(
            _trezor_params_vals(**{"1040": "01000000"})
        )

    with pytest.raises(ValueError, match="do not use serialized little-endian bytes"):
        calc.build_trezor_sign_transaction_params(
            _trezor_params_vals(**{"1040": "fdffffff"})
        )

    with pytest.raises(ValueError, match="must be decimal or 8-character display-order hex"):
        calc.build_trezor_sign_transaction_params(
            _trezor_params_vals(**{"1040": "le:fdffffff"})
        )

    with pytest.raises(ValueError, match="must be decimal or 8-character display-order hex"):
        calc.build_trezor_sign_transaction_params(
            _trezor_params_vals(**{"1040": "0xfffffffd"})
        )


def test_build_trezor_sign_transaction_params_rejects_bad_refs():
    with pytest.raises(ValueError, match="amount does not match previous raw transaction"):
        calc.build_trezor_sign_transaction_params(_trezor_params_vals(**{"1030": "123000"}))

    with pytest.raises(ValueError, match="appears byte-reversed"):
        calc.build_trezor_sign_transaction_params(
            _trezor_params_vals(**{"1010": PREVIOUS_TXID_REVERSED})
        )

    with pytest.raises(ValueError, match=r"input\[0\] derivation path is required"):
        calc.build_trezor_sign_transaction_params(_trezor_params_vals(**{"1000": ""}))


def test_public_key_from_private_key_known_vector():
    assert calc.public_key_from_private_key(SAMPLE_PRIV_KEY) == (
        "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    )


def test_ecies_encrypt_decrypt_roundtrip_with_deterministic_demo_inputs():
    recipient_priv = SAMPLE_PRIV_KEY
    recipient_pub = calc.public_key_from_private_key(recipient_priv)
    plaintext = "63210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac"
    aad = calc.hash160_hex(plaintext)
    ephemeral_priv = "02".rjust(64, "0")
    salt = "000102030405060708090a0b0c0d0e0f"

    envelope = calc.ecies_encrypt([
        recipient_pub,
        plaintext,
        aad,
        ephemeral_priv,
        salt,
    ])

    assert bytes.fromhex(envelope).startswith(b"RBECIES1")
    assert calc.ecies_decrypt([recipient_priv, envelope, aad]) == plaintext
    assert calc.ecies_encrypt([
        recipient_pub,
        plaintext,
        aad,
        ephemeral_priv,
        salt,
    ]) == envelope


def test_ecies_encrypt_is_deterministic_without_explicit_ephemeral_or_salt():
    recipient_priv = SAMPLE_PRIV_KEY
    recipient_pub = calc.public_key_from_private_key(recipient_priv)
    plaintext = "deadbeefcafe"
    aad = "0011"

    # Default path (no ephemeral key, no salt) must reproduce byte-for-byte.
    env1 = calc.ecies_encrypt([recipient_pub, plaintext, aad])
    env2 = calc.ecies_encrypt([recipient_pub, plaintext, aad])
    assert env1 == env2
    assert calc.ecies_decrypt([recipient_priv, env1, aad]) == plaintext

    # A different plaintext yields different ephemeral material (no keystream reuse).
    env_other = calc.ecies_encrypt([recipient_pub, "deadbeefcaff", aad])
    assert env_other != env1
    header_len = len(b"RBECIES1") + 33 + 16  # magic || ephemeral_pubkey || salt
    assert env_other[: header_len * 2] != env1[: header_len * 2]

    # A different aad also changes the envelope.
    assert calc.ecies_encrypt([recipient_pub, plaintext, "0012"]) != env1


def test_ecies_decrypt_rejects_wrong_aad_or_tampered_envelope():
    recipient_priv = SAMPLE_PRIV_KEY
    recipient_pub = calc.public_key_from_private_key(recipient_priv)
    plaintext = "00" * 20
    envelope = calc.ecies_encrypt([
        recipient_pub,
        plaintext,
        "aa",
        "02".rjust(64, "0"),
        "11" * 16,
    ])

    with pytest.raises(ValueError, match="authentication failed"):
        calc.ecies_decrypt([recipient_priv, envelope, "bb"])

    tampered = envelope[:-2] + ("00" if envelope[-2:] != "00" else "01")
    with pytest.raises(ValueError, match="authentication failed"):
        calc.ecies_decrypt([recipient_priv, tampered, "aa"])


def test_ecies_encrypt_accepts_uncompressed_recipient_pubkey():
    recipient_priv = SAMPLE_PRIV_KEY
    sk = SigningKey.from_string(bytes.fromhex(recipient_priv), curve=calc.SECP256k1)
    uncompressed_pub = "04" + sk.get_verifying_key().to_string().hex()
    envelope = calc.ecies_encrypt([
        uncompressed_pub,
        "deadbeef",
        "",
        "02".rjust(64, "0"),
        "22" * 16,
    ])

    assert calc.ecies_decrypt([recipient_priv, envelope, ""]) == "deadbeef"


def test_uint32_to_little_endian():
    assert calc.uint32_to_little_endian_4_bytes(1) == "01000000"
    with pytest.raises(ValueError):
        calc.uint32_to_little_endian_4_bytes(0x1_0000_0000)
    with pytest.raises(ValueError):
        calc.uint32_to_little_endian_4_bytes(-1)


def test_sighash_type_to_le4_standard_flags():
    assert calc.sighash_type_to_le4("01") == "01000000"
    assert calc.sighash_type_to_le4("02") == "02000000"
    assert calc.sighash_type_to_le4("03") == "03000000"
    assert calc.sighash_type_to_le4("0x81") == "81000000"
    assert calc.sighash_type_to_le4("82") == "82000000"
    assert calc.sighash_type_to_le4("83") == "83000000"


def test_sighash_type_to_le4_rejects_invalid_flags():
    invalid_values = ["", "1", "0100", "zz", "00", "04", "80", "84", "c1"]

    for value in invalid_values:
        with pytest.raises(ValueError):
            calc.sighash_type_to_le4(value)


def test_encode_varint_boundaries():
    assert calc.encode_varint(0) == "00"
    assert calc.encode_varint(0xfc) == "fc"
    assert calc.encode_varint(0xfd) == "fdfd00"
    assert calc.encode_varint(0x1_0000) == "fe00000100"
    assert calc.encode_varint(0x1_0000_0000) == "ff0000000001000000"
    with pytest.raises(ValueError):
        calc.encode_varint(-1)


def test_reverse_txid_bytes_and_satoshi_to_le():
    txid = "00" * 31 + "11"
    expected = bytes.fromhex(txid)[::-1].hex()
    assert calc.reverse_txid_bytes(txid) == expected
    with pytest.raises(ValueError):
        calc.reverse_txid_bytes("aa")
    assert calc.satoshi_to_8_le(5000) == "8813000000000000"


def test_double_and_single_sha256():
    assert calc.double_sha256_hex("") == (
        "5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456"
    )
    assert calc.sha256_hex("ff") == (
        "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89"
    )


GENESIS_HEADER = (
    "01000000"
    + "00" * 32
    + "3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a"
    + "29ab5f49"
    + "ffff001d"
    + "1dac2b7c"
)
GENESIS_TARGET = (
    "00000000ffff0000000000000000000000000000000000000000000000000000"
)
GENESIS_BLOCK_HASH = (
    "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"
)


def test_bits_to_target_mainnet_genesis_vector():
    result = json.loads(calc.bits_to_target(["1d00ffff"]))

    assert result["target"] == GENESIS_TARGET
    assert result["difficulty"] == "1.00"
    assert result["exponent"] == 0x1D
    assert result["mantissa"] == "00ffff"


@pytest.mark.parametrize(
    "bits, error",
    [
        ("1d80ffff", "negative target"),
        ("1d800000", "zero target"),
        ("21010000", "overflows a 256-bit target"),
        ("22000100", "overflows a 256-bit target"),
        ("23000001", "overflows a 256-bit target"),
        ("1d000000", "zero target"),
    ],
)
def test_bits_to_target_rejects_invalid_compact_values(bits, error):
    with pytest.raises(ValueError, match=error):
        calc.bits_to_target([bits])


@pytest.mark.parametrize(
    "bits, target",
    [
        ("2100ffff", "ffff" + "00" * 30),
        ("220000ff", "ff" + "00" * 31),
    ],
)
def test_bits_to_target_accepts_compact_sizes_above_32_when_they_fit(
    bits, target
):
    result = json.loads(calc.bits_to_target([bits]))

    assert result["target"] == target


def test_check_pow_accepts_genesis_and_reports_display_order_hash():
    result = json.loads(calc.check_pow([GENESIS_HEADER, GENESIS_TARGET]))

    assert result == {
        "valid": True,
        "block_hash": GENESIS_BLOCK_HASH,
    }


def test_check_pow_rejects_header_that_misses_target():
    invalid_header = GENESIS_HEADER[:-8] + "00000000"
    result = json.loads(calc.check_pow([invalid_header, GENESIS_TARGET]))

    assert result["valid"] is False
    assert len(result["block_hash"]) == 64


def test_mine_nonce_range_is_deterministic_and_finds_genesis_nonce():
    vals = [GENESIS_HEADER[:-8], "2083236893", "1", GENESIS_TARGET]

    first = calc.mine_nonce_range(vals)
    second = calc.mine_nonce_range(vals)
    result = json.loads(first)

    assert first == second
    assert result["found"] is True
    assert result["nonce"] == 2083236893
    assert result["nonce_le"] == "1dac2b7c"
    assert result["block_hash"] == GENESIS_BLOCK_HASH
    assert result["tried_start"] == result["tried_end"] == 2083236893
    assert result["next_start"] == 2083236894


def test_mine_nonce_range_not_found_window_advances_to_next_nonce():
    result = json.loads(
        calc.mine_nonce_range(
            [GENESIS_HEADER[:-8], "2083236892", "1", GENESIS_TARGET]
        )
    )

    assert result["found"] is False
    assert result["nonce"] is None
    assert result["nonce_le"] == ""
    assert result["tried_start"] == result["tried_end"] == 2083236892
    assert result["attempts"] == 1
    assert result["next_start"] == 2083236893


def test_mine_nonce_range_defaults_and_clamps_attempt_count():
    impossible_in_practice_target = "00" * 31 + "01"

    defaulted = json.loads(
        calc.mine_nonce_range(
            [GENESIS_HEADER[:-8], "0", "", impossible_in_practice_target]
        )
    )
    clamped = json.loads(
        calc.mine_nonce_range(
            [GENESIS_HEADER[:-8], "0", "100001", impossible_in_practice_target]
        )
    )

    assert defaulted["attempts"] == 100
    assert defaulted["next_start"] == 100
    assert clamped["attempts_requested"] == 100001
    assert clamped["attempts"] == 100000
    assert clamped["tried_end"] == 99999
    assert clamped["next_start"] == 100000


# ──────────────────────────────────────────────────────────────────────
# Taproot / Schnorr helpers
# ──────────────────────────────────────────────────────────────────────
def test_tagged_hash_matches_manual():
    tag = "TapTweak"
    data_hex = ""
    out = calc.tagged_hash([tag, data_hex])

    tag_hash = hashlib.sha256(tag.encode("utf-8")).digest()
    manual = hashlib.sha256(tag_hash + tag_hash + b"").hexdigest()
    assert out == manual


def test_xonly_pubkey_parity_and_secret_adjust():
    res = json.loads(calc.xonly_pubkey_from_private_key(SAMPLE_PRIV_KEY))
    # G has even Y
    assert res["xonly_pubkey"] == "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    assert res["parity"] == 0
    assert res["secret_key"] == SAMPLE_PRIV_KEY
    assert calc.xonly_pubkey(SAMPLE_PRIV_KEY) == res["xonly_pubkey"]
    assert calc.even_y_private_key(SAMPLE_PRIV_KEY) == SAMPLE_PRIV_KEY

    # pick a key with odd Y and ensure it flips to n-d
    odd_priv = "02".rjust(64, "0")
    res_odd = json.loads(calc.xonly_pubkey_from_private_key(odd_priv))
    sk_int = int(odd_priv, 16)
    curve_n = calc.SECP256k1.order  # type: ignore[attr-defined]
    vk = SigningKey.from_string(bytes.fromhex(odd_priv), curve=calc.SECP256k1).get_verifying_key()  # type: ignore[attr-defined]
    y_bytes = vk.to_string()[32:]
    parity_from_vk = y_bytes[-1] & 1
    assert res_odd["parity"] == parity_from_vk
    adjusted = (curve_n - sk_int) % curve_n if parity_from_vk else sk_int
    assert int(res_odd["secret_key"], 16) == adjusted
    assert calc.xonly_pubkey(odd_priv) == res_odd["xonly_pubkey"]
    assert int(calc.even_y_private_key(odd_priv), 16) == adjusted


def test_p2tr_address_from_xonly_returns_address_only():
    xonly = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    address = calc.p2tr_address_from_xonly(xonly)
    # hrp defaults to bcrt (regtest) in tests
    assert isinstance(address, str)
    assert address.startswith("bcrt1p")


def test_taproot_tweak_xonly_matches_private_version():
    xonly = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    from_pub = json.loads(calc.taproot_tweak_xonly_pubkey([xonly, ""]))
    assert len(from_pub["tweak"]) == 64
    assert len(from_pub["output_xonly_pubkey"]) == 64
    assert calc.taproot_output_pubkey_from_xonly([xonly, ""]) == from_pub["output_xonly_pubkey"]
    assert calc.taproot_tweaked_privkey([SAMPLE_PRIV_KEY, ""])


def test_taproot_tweak_helpers_reject_tweak_scalar_ge_curve_order(monkeypatch):
    n_bytes = calc._CURVE_ORDER.to_bytes(32, "big")
    monkeypatch.setattr(calc, "_tagged_hash_bytes", lambda _tag, _data: n_bytes)

    xonly = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    with pytest.raises(ValueError, match="TapTweak scalar must be less than curve order"):
        calc.taproot_tweak_xonly_pubkey([xonly, ""])
    with pytest.raises(ValueError, match="TapTweak scalar must be less than curve order"):
        calc.taproot_output_pubkey_from_xonly([xonly, ""])
    with pytest.raises(ValueError, match="TapTweak scalar must be less than curve order"):
        calc.taproot_tweaked_privkey([SAMPLE_PRIV_KEY, ""])


def test_schnorr_sign_and_verify_roundtrip():
    msg = "00" * 32
    sig = calc.schnorr_sign_bip340([SAMPLE_PRIV_KEY, msg, "00" * 32])
    assert len(sig) == 128
    pub_xonly = json.loads(calc.xonly_pubkey_from_private_key(SAMPLE_PRIV_KEY))["xonly_pubkey"]
    assert calc.schnorr_verify_bip340([pub_xonly, msg, sig]) == "true"


def test_taproot_sighash_default_shapes():
    tx_hex = build_sample_tx_hex()
    amounts = json.dumps([0])  # dummy amount for the single input
    spks = json.dumps(["5120" + "00" * 32])
    res = json.loads(calc.taproot_sighash_default([tx_hex, 0, amounts, spks]))
    assert len(res["sighash"]) == 64
    assert len(res["sha_prevouts"]) == 64
    assert len(res["sha_outputs"]) == 64
    assert res["hash_type"] == 0


def test_taproot_sighash_default_handles_bit31_version():
    # bitcointx parses nVersion as signed int32; 0xffffffff must not crash.
    tx_hex = "ffffffff" + build_sample_tx_hex()[8:]
    amounts = json.dumps([0])
    spks = json.dumps(["5120" + "00" * 32])
    res = json.loads(calc.taproot_sighash_default([tx_hex, 0, amounts, spks]))
    assert len(res["sighash"]) == 64
    # preimage = epoch(00) + hash_type(00) + nVersion little-endian
    assert res["preimage"][4:12] == "ffffffff"


def test_taproot_tree_builder_paths_and_root():
    leaf_a = "62dd3a7a192e65aa45d23c1516e54de59191037294c6b20d993a63daae764c60"
    leaf_b = "a7ff651bdc752b612bd6266420bf5a4ff1b87fec33a396ba0d5037c336332aba"
    leaf_c = "c9e9e0619c989bbd70d5153879acc2a692d8d7f8b4c5919c6089491fbcf77405"

    def tapbranch_hex(left_hex: str, right_hex: str) -> str:
        left = bytes.fromhex(left_hex)
        right = bytes.fromhex(right_hex)
        left, right = sorted([left, right])
        tag_hash = hashlib.sha256(b"TapBranch").digest()
        return hashlib.sha256(tag_hash + tag_hash + left + right).hexdigest()

    res = json.loads(calc.taproot_tree_builder([leaf_a, leaf_b, leaf_c]))

    assert res["root"] == "33fae60e42155f64da2ed49f02e81cff0d913a2c526b43896a940e2acc6177ef"
    assert res["leafCount"] == 3
    assert res["leafLabels"] == ["A", "B", "C"]
    assert res["leafHashes"] == [leaf_a, leaf_b, leaf_c]
    assert res["structure"] == "((A,B),C)"
    assert res["paths"][0] == [leaf_b, leaf_c]
    assert res["paths"][1] == [leaf_a, leaf_c]
    assert res["paths"][2] == [tapbranch_hex(leaf_a, leaf_b)]


def _bitcoin_merkle_reference(hashes: list[str]) -> str:
    level = [bytes.fromhex(value) for value in hashes]
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [
            hashlib.sha256(
                hashlib.sha256(level[index] + level[index + 1]).digest()
            ).digest()
            for index in range(0, len(level), 2)
        ]
    return level[0].hex()


def test_bitcoin_merkle_tree_known_three_transaction_block():
    coinbase = "91bbf2ace7ce00fc4a0115eafa16bdde5744b2ae74f274952fdd8a46aa6d9465"
    parent = "3e8474e5399082fbee784fb8c883a8c316b8c98aed5272f27ccf2dd60785e195"
    child = "afacc7021504e4dbfaef88ae929011f02f4b9bf5097527a72addfb1932dcf264"

    result = json.loads(calc.bitcoin_merkle_tree([coinbase, parent, child]))

    assert result["root"] == (
        "4ed8d0af210b993363424c89a17363d269a8a494e0d02bb9b52b04178f2b7c8f"
    )
    assert result["pairs"][0]["parentHash"] == (
        "4f2a17a4051f537cca87dd5a8e4f8d56e049e7b9636f5d24657f9a7458194bc8"
    )
    assert result["pairs"][1]["parentHash"] == (
        "195a822a409b8df483bb342d8e6100ba168fa1cb6e6bf1daf79e8bd86b3db801"
    )
    assert result["pairs"][1]["syntheticRight"] is True
    assert result["pairs"][1]["equal"] is True
    assert result["pairs"][1]["mutation"] is False
    assert result["mutated"] is False
    assert result["duplicateCount"] == 1
    assert result["duplicatedIndices"] == [[3], [], []]
    assert result["levelLabels"][0] == [
        "TX0",
        "TX1",
        "TX2",
        "TX2",
    ]
    assert result["structure"] == "((TX0,TX1),(TX2,TX2))"
    assert "TX2 (duplicate)" in result["display"]


@pytest.mark.parametrize(
    ("leaf_count", "duplicate_count", "duplicated_indices"),
    [
        (1, 0, [[]]),
        (2, 0, [[], []]),
        (3, 1, [[3], [], []]),
        (5, 2, [[5], [3], [], []]),
        (10, 2, [[], [5], [3], [], []]),
    ],
)
def test_bitcoin_merkle_tree_sizes_and_odd_duplication(
    leaf_count, duplicate_count, duplicated_indices
):
    leaves = [
        hashlib.sha256(f"transaction-{index}".encode()).hexdigest()
        for index in range(leaf_count)
    ]

    result = json.loads(calc.bitcoin_merkle_tree(leaves))

    assert result["root"] == _bitcoin_merkle_reference(leaves)
    assert result["leafCount"] == leaf_count
    assert result["leafHashes"] == leaves
    assert result["duplicateCount"] == duplicate_count
    assert result["duplicatedIndices"] == duplicated_indices
    assert result["mutated"] is False
    assert result["mutatedPairs"] == []
    assert result["levels"][-1] == [result["root"]]
    assert result["levelLabels"][-1] == ["ROOT"]


def test_bitcoin_merkle_tree_marks_a_higher_level_synthetic_branch():
    leaves = [f"{index + 1:02x}" * 32 for index in range(5)]
    result = json.loads(calc.bitcoin_merkle_tree(leaves))

    # Five leaves duplicate TX4 at L0, then duplicate its H1.2 parent at L1.
    higher_duplicate = result["tree"]["right"]["right"]
    assert higher_duplicate == {
        "hash": result["levels"][1][2],
        "label": "H1.2",
        "duplicated": True,
        "duplicateOf": "H1.2",
    }
    assert result["oddDuplications"][1]["level"] == 1
    assert result["pairs"][4]["syntheticRight"] is True


def test_bitcoin_merkle_tree_single_leaf_is_not_hashed():
    leaf = "ab" * 32
    result = json.loads(calc.bitcoin_merkle_tree([leaf]))

    assert result["root"] == leaf
    assert result["levels"] == [[leaf]]
    assert result["pairs"] == []
    assert result["duplicateCount"] == 0
    assert result["mutated"] is False
    assert result["structure"] == "TX0"
    assert result["tree"]["leafIndex"] == 0


def test_bitcoin_merkle_tree_preserves_order_without_sorting():
    left = "01" * 32
    right = "02" * 32

    forward = json.loads(calc.bitcoin_merkle_tree([left, right]))
    reversed_order = json.loads(calc.bitcoin_merkle_tree([right, left]))

    assert forward["root"] != reversed_order["root"]
    assert forward["pairs"][0]["leftHash"] == left
    assert forward["pairs"][0]["rightHash"] == right


@pytest.mark.parametrize(
    ("leaves", "expected_mutated", "mutation_level"),
    [
        (["01" * 32, "01" * 32], True, 0),
        (["01" * 32, "02" * 32, "02" * 32], False, None),
        (["01" * 32, "02" * 32, "02" * 32, "02" * 32], True, 0),
        (["01" * 32, "02" * 32, "01" * 32, "02" * 32], True, 1),
    ],
)
def test_bitcoin_merkle_tree_matches_core_mutation_semantics(
    leaves, expected_mutated, mutation_level
):
    result = json.loads(calc.bitcoin_merkle_tree(leaves))

    assert result["mutated"] is expected_mutated
    if mutation_level is None:
        assert result["mutatedPairs"] == []
    else:
        assert any(
            pair["level"] == mutation_level
            for pair in result["mutatedPairs"]
        )


def test_bitcoin_merkle_tree_mutation_collision_keeps_same_root():
    a = "00" * 32
    b = "11" * 32
    c = "22" * 32

    padded = json.loads(calc.bitcoin_merkle_tree([a, b, c]))
    explicit_duplicate = json.loads(calc.bitcoin_merkle_tree([a, b, c, c]))

    assert padded["root"] == explicit_duplicate["root"]
    assert padded["mutated"] is False
    assert padded["duplicateCount"] == 1
    assert explicit_duplicate["mutated"] is True
    assert explicit_duplicate["duplicateCount"] == 0


def test_bitcoin_merkle_tree_accepts_99_transactions():
    leaves = [
        hashlib.sha256(f"transaction-{index}".encode()).hexdigest()
        for index in range(99)
    ]

    result = json.loads(calc.bitcoin_merkle_tree(leaves))

    assert result["leafCount"] == 99
    assert result["root"] == _bitcoin_merkle_reference(leaves)


@pytest.mark.parametrize(
    ("hashes", "message"),
    [
        ([], "at least one"),
        ([""], "cannot be empty"),
        (["00"], "must be 32 bytes"),
        (["00" * 31], "must be 32 bytes"),
        (["00" * 33], "must be 32 bytes"),
        (["gg" * 32], "not valid hexadecimal"),
        (["0" * 63], "even"),
        (["00" * 32] * 100, "at most 99"),
    ],
)
def test_bitcoin_merkle_tree_rejects_invalid_inputs(hashes, message):
    with pytest.raises(ValueError, match=message):
        calc.bitcoin_merkle_tree(hashes)


def test_musig2_aggregate_pubkeys():
    pk1 = calc.public_key_from_private_key(SAMPLE_PRIV_KEY)
    pk2 = calc.public_key_from_private_key("02".rjust(64, "0"))
    res = json.loads(calc.musig2_aggregate_pubkeys([pk1, pk2]))
    assert len(res["aggregated_pubkey"]) == 64
    assert len(res["coefficients"]) == 2


def _musig2_signer_set():
    privkeys = [
        SAMPLE_PRIV_KEY,
        "02".rjust(64, "0"),
        "03".rjust(64, "0"),
    ]
    pubkeys = [
        calc.public_key_from_private_key(sk)
        for sk in privkeys
    ]
    return privkeys, pubkeys


def _musig2_tweaked_context(pubkeys: list[str]) -> tuple[dict, str]:
    ctx = json.loads(calc.musig2_aggregate_pubkeys(pubkeys))
    tweak_info = json.loads(
        calc.taproot_tweak_xonly_pubkey([ctx["aggregated_pubkey"], ""])
    )
    tweak = tweak_info["tweak"]
    tweaked_ctx = json.loads(
        calc.musig2_apply_tweak([json.dumps(ctx), tweak, "true"])
    )
    return tweaked_ctx, tweak


def _musig2_build_signature(
    privkeys: list[str],
    pubkeys: list[str],
    msg: str,
    q_xonly: str,
    tweak: str,
) -> str:
    nonces = []
    for i, (sk, pk) in enumerate(zip(privkeys, pubkeys)):
        aux = f"{i + 1:02x}" * 32
        nonces.append(json.loads(calc.musig2_nonce_gen([sk, pk, q_xonly, msg, aux])))

    aggnonce = calc.musig2_nonce_agg([n["pubnonce"] for n in nonces])
    partial_sigs = []
    for sk, nonce in zip(privkeys, nonces):
        partial_sigs.append(
            calc.musig2_partial_sign(
                [sk, nonce["secnonce"], aggnonce, msg, tweak, *pubkeys]
            )
        )

    return calc.musig2_partial_sig_agg(
        [aggnonce, msg, tweak, *pubkeys, *partial_sigs]
    )


def test_musig2_keyagg_and_tweak_helpers():
    _, pubkeys = _musig2_signer_set()

    one_key_details = calc._musig2_keyagg_details(pubkeys[:1])
    assert one_key_details["num_pubkeys"] == 1
    assert len(one_key_details["L"]) == 32
    assert len(one_key_details["coeffs"]) == 1

    details = calc._musig2_keyagg_details(pubkeys[:2])
    assert details["num_pubkeys"] == 2
    assert len(details["L"]) == 32
    assert len(details["coeffs"]) == 2
    assert len(details["coeffs_info"]) == 2
    assert details["pk2"] in details["plain_list"]

    Q, gacc, tacc = calc._musig2_apply_tweak_to_point(details["agg_pt"], b"")
    assert Q != calc.ellipticcurve.INFINITY
    assert gacc in (1, calc._CURVE_ORDER - 1)
    assert tacc == 0

    with pytest.raises(ValueError, match="32 bytes"):
        calc._musig2_apply_tweak_to_point(details["agg_pt"], b"\x01")


def test_musig2_nonce_coeff_zero_fallback(monkeypatch):
    monkeypatch.setattr(calc, "_tagged_hash_bytes", lambda _tag, _data: b"\x00" * 32)
    assert calc._musig2_nonce_coeff(b"\x02" * 66, b"\x03" * 32, b"\x04" * 32) == 0


def test_musig2_apply_tweak_updates_context_and_validates_inputs():
    _, pubkeys = _musig2_signer_set()
    ctx = json.loads(calc.musig2_aggregate_pubkeys(pubkeys[:2]))
    tweak = json.loads(
        calc.taproot_tweak_xonly_pubkey([ctx["aggregated_pubkey"], ""])
    )["tweak"]

    res = json.loads(calc.musig2_apply_tweak([json.dumps(ctx), tweak, "true"]))
    assert len(res["aggregated_pubkey"]) == 64
    assert res["pre_tweak_pubkey"] == ctx["aggregated_pubkey"]
    assert res["tweak_mode"] == "xonly"
    assert len(res["gacc"]) == 64
    assert len(res["tacc"]) == 64

    with pytest.raises(ValueError, match="Tweak must be 32 bytes"):
        calc.musig2_apply_tweak([json.dumps(ctx), "aa", "true"])
    with pytest.raises(ValueError, match="valid scalar"):
        calc.musig2_apply_tweak([json.dumps(ctx), "ff" * 32, "true"])


def test_musig2_nonce_gen_and_nonce_agg():
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, _tweak = _musig2_tweaked_context(pubkeys)
    Q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "42" * 32

    nonce_a = json.loads(
        calc.musig2_nonce_gen([privkeys[0], pubkeys[0], Q_xonly, msg, "11" * 32])
    )
    nonce_b = json.loads(
        calc.musig2_nonce_gen([privkeys[1], pubkeys[1], Q_xonly, msg, "22" * 32])
    )
    assert len(nonce_a["pubnonce"]) == 132
    assert len(nonce_a["secnonce"]) == 194
    assert len(nonce_b["pubnonce"]) == 132
    assert len(nonce_b["secnonce"]) == 194

    aggnonce = calc.musig2_nonce_agg([nonce_a["pubnonce"], nonce_b["pubnonce"]])
    assert len(aggnonce) == 132

    one_aggnonce = calc.musig2_nonce_agg([nonce_a["pubnonce"]])
    assert one_aggnonce == nonce_a["pubnonce"]
    with pytest.raises(ValueError, match="66 bytes"):
        calc.musig2_nonce_agg(["00", "00"])


def test_musig2_partial_sign_and_agg_roundtrip():
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    Q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "ab" * 32

    nonces = []
    for i, (sk, pk) in enumerate(zip(privkeys, pubkeys)):
        aux = f"{i + 1:02x}" * 32
        nonces.append(json.loads(calc.musig2_nonce_gen([sk, pk, Q_xonly, msg, aux])))

    aggnonce = calc.musig2_nonce_agg([n["pubnonce"] for n in nonces])
    partial_sigs = []
    for sk, nonce in zip(privkeys, nonces):
        partial_sigs.append(
            calc.musig2_partial_sign(
                [sk, nonce["secnonce"], aggnonce, msg, tweak, *pubkeys]
            )
        )

    assert all(len(sig) == 64 for sig in partial_sigs)

    final_sig = calc.musig2_partial_sig_agg(
        [aggnonce, msg, tweak, *pubkeys, *partial_sigs]
    )
    assert len(final_sig) == 128
    assert calc.schnorr_verify_bip340([Q_xonly, msg, final_sig]) == "true"

    with pytest.raises(ValueError, match="Signer pubkey not found"):
        calc.musig2_partial_sign(
            [
                privkeys[0],
                nonces[0]["secnonce"],
                aggnonce,
                msg,
                tweak,
                *pubkeys[1:],
            ]
        )

    with pytest.raises(ValueError, match="equal counts"):
        calc.musig2_partial_sig_agg(
            [aggnonce, msg, tweak, *pubkeys, *partial_sigs, "00" * 32]
        )


def test_musig2_partial_sig_verify_roundtrip_and_tamper_detection():
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "ab" * 32

    nonces = []
    for i, (sk, pk) in enumerate(zip(privkeys, pubkeys)):
        aux = f"{i + 1:02x}" * 32
        nonces.append(json.loads(calc.musig2_nonce_gen([sk, pk, q_xonly, msg, aux])))

    aggnonce = calc.musig2_nonce_agg([n["pubnonce"] for n in nonces])
    partial_sigs = []
    for sk, nonce in zip(privkeys, nonces):
        partial_sigs.append(
            calc.musig2_partial_sign(
                [sk, nonce["secnonce"], aggnonce, msg, tweak, *pubkeys]
            )
        )

    for i in range(len(pubkeys)):
        ok = calc.musig2_partial_sig_verify(
            [
                partial_sigs[i],
                nonces[i]["pubnonce"],
                pubkeys[i],
                aggnonce,
                msg,
                tweak,
                *pubkeys,
            ]
        )
        assert ok == "true"

    bad_sig = partial_sigs[1]
    bad_last = "0" if bad_sig[-1] != "0" else "1"
    tampered = bad_sig[:-1] + bad_last
    assert (
        calc.musig2_partial_sig_verify(
            [
                tampered,
                nonces[1]["pubnonce"],
                pubkeys[1],
                aggnonce,
                msg,
                tweak,
                *pubkeys,
            ]
        )
        == "false"
    )


def test_musig2_partial_sign_performs_internal_self_check(monkeypatch):
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys[:2])
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "11" * 32

    nonce_a = json.loads(
        calc.musig2_nonce_gen([privkeys[0], pubkeys[0], q_xonly, msg, "aa" * 32])
    )
    nonce_b = json.loads(
        calc.musig2_nonce_gen([privkeys[1], pubkeys[1], q_xonly, msg, "bb" * 32])
    )
    aggnonce = calc.musig2_nonce_agg([nonce_a["pubnonce"], nonce_b["pubnonce"]])

    monkeypatch.setattr(calc, "_musig2_partial_sig_verify_internal", lambda *args: False)
    with pytest.raises(ValueError, match="Internal partial signature verification failed"):
        calc.musig2_partial_sign(
            [privkeys[0], nonce_a["secnonce"], aggnonce, msg, tweak, *pubkeys[:2]]
        )


def test_musig2_roundtrip_wrong_message_fails():
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "ab" * 32

    final_sig = _musig2_build_signature(privkeys, pubkeys, msg, q_xonly, tweak)
    assert calc.schnorr_verify_bip340([q_xonly, msg, final_sig]) == "true"
    assert calc.schnorr_verify_bip340([q_xonly, "cd" * 32, final_sig]) == "false"


def test_musig2_roundtrip_wrong_key_fails():
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "ab" * 32

    final_sig = _musig2_build_signature(privkeys, pubkeys, msg, q_xonly, tweak)
    wrong_key = json.loads(
        calc.xonly_pubkey_from_private_key("04".rjust(64, "0"))
    )["xonly_pubkey"]
    assert calc.schnorr_verify_bip340([wrong_key, msg, final_sig]) == "false"


def test_musig2_roundtrip_no_tweak_verifies():
    privkeys, pubkeys = _musig2_signer_set()
    agg_ctx = json.loads(calc.musig2_aggregate_pubkeys(pubkeys))
    p_xonly = agg_ctx["aggregated_pubkey"]
    msg = "7f" * 32

    final_sig = _musig2_build_signature(privkeys, pubkeys, msg, p_xonly, "")
    assert calc.schnorr_verify_bip340([p_xonly, msg, final_sig]) == "true"


def test_musig2_roundtrip_two_signers_verifies():
    privkeys, pubkeys = _musig2_signer_set()
    privkeys = privkeys[:2]
    pubkeys = pubkeys[:2]
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "9a" * 32

    final_sig = _musig2_build_signature(privkeys, pubkeys, msg, q_xonly, tweak)
    assert calc.schnorr_verify_bip340([q_xonly, msg, final_sig]) == "true"


def test_musig2_roundtrip_single_signer_verifies():
    privkeys, pubkeys = _musig2_signer_set()
    privkeys = privkeys[:1]
    pubkeys = pubkeys[:1]
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "5c" * 32

    final_sig = _musig2_build_signature(privkeys, pubkeys, msg, q_xonly, tweak)
    assert calc.schnorr_verify_bip340([q_xonly, msg, final_sig]) == "true"


def test_musig2_public_apis_reject_additional_malformed_inputs():
    privkeys, pubkeys = _musig2_signer_set()
    tweaked_ctx, tweak = _musig2_tweaked_context(pubkeys)
    q_xonly = tweaked_ctx["aggregated_pubkey"]
    msg = "ab" * 32

    nonce_a = json.loads(calc.musig2_nonce_gen([privkeys[0], pubkeys[0], q_xonly, msg, "11" * 32]))
    nonce_b = json.loads(calc.musig2_nonce_gen([privkeys[1], pubkeys[1], q_xonly, msg, "22" * 32]))
    aggnonce = calc.musig2_nonce_agg([nonce_a["pubnonce"], nonce_b["pubnonce"]])

    with pytest.raises(ValueError, match="hexadecimal"):
        calc.musig2_aggregate_pubkeys(["zz", "11" * 32])
    with pytest.raises(ValueError, match="Need \\[key_agg_ctx_json, tweak_hex, is_xonly\\]"):
        calc.musig2_apply_tweak(["{}"])
    with pytest.raises(ValueError, match="Aggregate pubkey must be 32 bytes"):
        calc.musig2_nonce_gen([privkeys[0], pubkeys[0], "aa", msg, "11" * 32])
    with pytest.raises(ValueError, match="rand input is required"):
        calc.musig2_nonce_gen([privkeys[0], pubkeys[0], q_xonly, msg])
    with pytest.raises(ValueError):
        calc.musig2_nonce_agg(
            ["00" + "11" * 32 + "00" + "22" * 32, "00" + "33" * 32 + "00" + "44" * 32]
        )
    with pytest.raises(ValueError, match="Secnonce must be 97 bytes"):
        calc.musig2_partial_sign([privkeys[0], "00" * 96, aggnonce, msg, tweak, *pubkeys])
    with pytest.raises(ValueError, match="Partial signature must be 32 bytes"):
        calc.musig2_partial_sig_verify(
            [
                "11" * 31,
                nonce_a["pubnonce"],
                pubkeys[0],
                aggnonce,
                msg,
                tweak,
                *pubkeys,
            ]
        )
    with pytest.raises(ValueError, match="Signer pubkey not found"):
        calc.musig2_partial_sig_verify(
            [
                "11" * 32,
                nonce_a["pubnonce"],
                pubkeys[0],
                aggnonce,
                msg,
                tweak,
                *pubkeys[1:],
            ]
        )
    with pytest.raises(ValueError, match="partial_sig\\[0\\] must be 32 bytes"):
        calc.musig2_partial_sig_agg(
            [aggnonce, msg, tweak, *pubkeys[:2], "11" * 31, "22" * 32]
        )


def test_schnorr_batch_verify_demo_single_entry():
    msg = "11" * 32
    sig = calc.schnorr_sign_bip340([SAMPLE_PRIV_KEY, msg, "00" * 32])
    pk = json.loads(calc.xonly_pubkey_from_private_key(SAMPLE_PRIV_KEY))["xonly_pubkey"]
    res = json.loads(calc.schnorr_batch_verify_demo([pk, msg, sig]))
    assert res["left_scalar"].startswith("0x")
    assert len(res["right_xonly"]) == 64
    assert isinstance(res["weights"], list)
    assert len(res["weights"]) == 1
    assert res["weights"][0] != 0


def test_sign_and_verify_low_r_signature():
    signature = calc.sign_as_bitcoin_core_low_r([SAMPLE_PRIV_KEY, SAMPLE_MSG_HASH])
    assert signature == SAMPLE_SIGNATURE
    result = calc.verify_signature([
        calc.public_key_from_private_key(SAMPLE_PRIV_KEY),
        SAMPLE_MSG_HASH,
        signature,
    ])
    assert result == "true"


def test_sign_tx_rfc6979_matches_deterministic_ecdsa_without_low_r_grinding():
    sk = SigningKey.from_string(bytes.fromhex(SAMPLE_PRIV_KEY), curve=calc.SECP256k1)
    expected = sk.sign_digest_deterministic(
        bytes.fromhex(SAMPLE_MSG_HASH),
        hashfunc=hashlib.sha256,
        sigencode=sigencode_der_canonize,
    ).hex()

    signature = calc.sign_tx_rfc6979([SAMPLE_PRIV_KEY, SAMPLE_MSG_HASH])
    public_key = calc.public_key_from_private_key(SAMPLE_PRIV_KEY)

    assert signature == expected
    assert calc.verify_signature([public_key, SAMPLE_MSG_HASH, signature]) == "true"


def test_sign_tx_rfc6979_does_not_grind_to_low_r():
    msg = "c92b3e85d7598dd8e016e41a85a5b084145f6445a3e91a98601f80de9c6fab7c"
    rfc6979_signature = calc.sign_tx_rfc6979([SAMPLE_PRIV_KEY, msg])
    low_r_signature = calc.sign_as_bitcoin_core_low_r([SAMPLE_PRIV_KEY, msg])
    public_key = calc.public_key_from_private_key(SAMPLE_PRIV_KEY)

    assert rfc6979_signature != low_r_signature
    assert calc.verify_signature([public_key, msg, rfc6979_signature]) == "true"
    assert calc.verify_signature([public_key, msg, low_r_signature]) == "true"


def test_sign_tx_rfc6979_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="Need"):
        calc.sign_tx_rfc6979([SAMPLE_PRIV_KEY])
    with pytest.raises(ValueError, match="must be 32 bytes each"):
        calc.sign_tx_rfc6979([SAMPLE_PRIV_KEY, "00" * 31])


def test_write_low_r_and_serialize_helpers():
    ctx = calc._get_sign_ctx()
    sig_ptr = secp256k1.ffi.new("secp256k1_ecdsa_signature *")
    der = bytes.fromhex(SAMPLE_SIGNATURE)
    res = secp256k1.lib.secp256k1_ecdsa_signature_parse_der(ctx, sig_ptr, der, len(der))
    assert res == 1

    assert calc._is_low_r(ctx, sig_ptr) is True
    assert calc._serialize_der(ctx, sig_ptr) == SAMPLE_SIGNATURE

    buf = secp256k1.ffi.new("unsigned char[32]")
    calc._write_le32(buf, 0xDEADBEEF)
    assert bytes(secp256k1.ffi.buffer(buf, 4)) == b"\xef\xbe\xad\xde"


def test_hash160_and_varint_length():
    assert calc.hash160_hex("00") == "9f7fd096d37ed2c0e3f7f0cfc924beef4ffceb68"
    assert calc.varint_encoded_byte_length("aa") == "01"
    assert calc.varint_encoded_byte_length("aa" * 300) == "fd2c01"


def test_script_verification_simple_true():
    tx_hex = build_sample_tx_hex()
    result_json = calc.script_verification(["", "51", tx_hex, 0, "", ""])
    result = json.loads(result_json)
    assert result["isValid"] is True
    assert result["scriptPubKey"] == "51"
    assert result["witnessRulesEnabled"] is True
    assert result["usesWitness"] is False
    assert "amountUsed" not in result


def test_script_verification_empty_tx_uses_parseable_dummy():
    # Standalone script-debugging mode: no tx hex supplied.
    result = json.loads(calc.script_verification(["", "51"]))
    assert result["isValid"] is True
    assert result["scriptPubKey"] == "51"


def test_script_verification_names_direct_push_opcodes():
    tx_hex = build_sample_tx_hex()
    result = json.loads(calc.script_verification(["02abcd", "51", tx_hex, 0, "CLEANSTACK"]))
    assert result["steps"][0]["opcode"] == 2
    assert result["steps"][0]["opcode_name"] == "PUSH 2 bytes"


def test_encode_script_push_data_cases():
    assert calc.encode_script_push_data("") == "00"
    assert calc.encode_script_push_data("ff") == "01"
    assert calc.encode_script_push_data("00" * 76) == "4c4c"
    assert calc.encode_script_push_data("00" * 300) == "4d2c01"


def test_bip110_picture_p2sh_scripts_builds_520_byte_full_script():
    pubkey = "02" + "11" * 32
    picture_hex = "aa" * 480

    result = json.loads(calc.bip110_picture_p2sh_scripts([picture_hex, pubkey]))
    script = result["scripts"][0]["script"]

    assert result["count"] == 1
    assert result["total_bytes"] == 480
    assert result["scripts"][0]["chunk1_bytes"] == 240
    assert result["scripts"][0]["chunk2_bytes"] == 240
    assert result["scripts"][0]["script_bytes"] == 520
    assert script == (
        "4cf0"
        + "aa" * 240
        + "4cf0"
        + "aa" * 240
        + "6d21"
        + pubkey
        + "ac"
    )


def test_bip110_picture_p2sh_scripts_uses_empty_second_chunk_for_partial_tail():
    pubkey = "03" + "22" * 32

    result = json.loads(calc.bip110_picture_p2sh_scripts(["bb" * 1, pubkey]))
    script = result["scripts"][0]["script"]

    assert result["count"] == 1
    assert result["scripts"][0]["chunk1_bytes"] == 1
    assert result["scripts"][0]["chunk2_bytes"] == 0
    assert script == "01bb006d21" + pubkey + "ac"


def test_opcode_select_and_int_to_script_bytes():
    assert calc.op_code_select(["OP_DUP", "OP_HASH160"]) == "76a9"
    assert calc.op_code_select(["P2PKH_PREFIX", "P2PKH_SUFFIX"]) == "76a91488ac"
    with pytest.raises(ValueError, match="Unknown opcode"):
        calc.op_code_select(["OP_NOPE"])
    assert calc.int_to_script_bytes(0) == ""
    assert calc.int_to_script_bytes(4404774) == "263643"
    with pytest.raises(ValueError):
        calc.int_to_script_bytes("abc")


def test_opcode_select_2of3_multisig_template():
    assert calc.op_code_select(["2OF3_MULTISIG_PREFIX"]) == "5221"
    # OP_3 OP_CHECKMULTISIG — no stray OP_2 after the last pubkey.
    assert calc.op_code_select(["2OF3_MULTISIG_SUFFIX"]) == "53ae"


def test_text_to_hex_and_block_sequence():
    assert calc.text_to_hex("satoshi") == "7361746f736869"
    assert calc.hex_to_text("7361746f736869") == "satoshi"
    assert calc.hex_to_text("48656c6c6f20e282bf") == "Hello ₿"
    with pytest.raises(ValueError, match=r"\*even\* number"):
        calc.hex_to_text("abc")
    with pytest.raises(ValueError, match="not valid UTF-8"):
        calc.hex_to_text("ff")
    assert calc.blocks_to_sequence_number(144) == 144
    with pytest.raises(ValueError):
        calc.blocks_to_sequence_number(-1)


def test_hash160_addresses_conversions():
    assert calc.hash160_to_p2sh_address("f" * 40, "mainnet") == "3R2cuenjG5nFubqX9Wzuukdin2YfBbQ6Kw"
    assert calc.hash160_to_p2pkh_address(GENESIS_HASH160, "mainnet") == "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    assert calc.hash160_to_p2wpkh_address(GENESIS_HASH160, "mainnet") == "bc1qvt5s0v2uhuna2sjnn84ldu8m2r4m3rcc4048ry"
    assert calc.sha256_to_p2wsh_address("0" * 64, "mainnet") == "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqthqst8"


def test_signet_address_outputs_match_testnet():
    xonly = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    script_hash = "f" * 40
    script_sha = "0" * 64

    assert calc.p2tr_address_from_xonly(
        xonly, "signet"
    ) == calc.p2tr_address_from_xonly(xonly, "testnet")
    assert calc.hash160_to_p2sh_address(
        script_hash, "signet"
    ) == calc.hash160_to_p2sh_address(script_hash, "testnet")
    assert calc.hash160_to_p2pkh_address(
        GENESIS_HASH160, "signet"
    ) == calc.hash160_to_p2pkh_address(GENESIS_HASH160, "testnet")
    assert calc.hash160_to_p2wpkh_address(
        GENESIS_HASH160, "signet"
    ) == calc.hash160_to_p2wpkh_address(GENESIS_HASH160, "testnet")
    assert calc.sha256_to_p2wsh_address(
        script_sha, "signet"
    ) == calc.sha256_to_p2wsh_address(script_sha, "testnet")


def test_date_to_unix_timestamp_parsing():
    assert calc.date_to_unix_timestamp("2025-01-01") == "1735689600"
    with pytest.raises(ValueError):
        calc.date_to_unix_timestamp("2024/01/01")


def test_date_to_unix_timestamp_bounds():
    with pytest.raises(ValueError, match="too early"):
        calc.date_to_unix_timestamp("1985-10-26")
    with pytest.raises(ValueError, match="too far in the future"):
        calc.date_to_unix_timestamp("2150-01-01T00:00:00+00:00")


def test_reverse_bytes_and_hours_to_sequence():
    assert calc.reverse_bytes_4("01000000") == "00000001"
    with pytest.raises(ValueError):
        calc.reverse_bytes_4("ff")
    assert calc.hours_to_sequence_number(1.5) == 11
    assert calc.hours_to_sequence_number("1.0") == 7
    with pytest.raises(ValueError):
        calc.hours_to_sequence_number("not-a-number")


def test_hours_to_sequence_number_upper_bound_hours():
    with pytest.raises(ValueError, match="Time delay must be <="):
        calc.hours_to_sequence_number(9340)


def test_encode_sequence_flags():
    assert calc.encode_sequence_block_flag("144") == 144
    assert calc.encode_sequence_time_flag("7") == (7 | (1 << 22))
    with pytest.raises(ValueError):
        calc.encode_sequence_block_flag(-1)
    with pytest.raises(ValueError):
        calc.encode_sequence_time_flag(0x1_0000)


def test_opcode_to_value_and_errors():
    assert calc.opcode_to_value("51") == 1
    assert calc.opcode_to_value("4f") == -1
    assert calc.opcode_to_value("00") == 0
    with pytest.raises(ValueError):
        calc.opcode_to_value("ff")


def test_opcode_to_value_rejects_bad_format():
    with pytest.raises(ValueError, match="exactly 2 hex"):
        calc.opcode_to_value("000")
    with pytest.raises(ValueError, match="Invalid hex"):
        calc.opcode_to_value("zz")


def test_extract_tx_field_reads_components():
    values = {
        "version": "2",
        "locktime": "0",
        "input_count": "1",
        "output_count": "1",
        "txid": calc.extract_tx_field([SAMPLE_TX_HEX, "txid"]),
        "vin.txid": calc.extract_tx_field([SAMPLE_TX_HEX, "vin.txid", "0"]),
        "vin.vout": "0",
        "vin.scriptSig": "51",
        "vin.sequence": "4294967295",
        "vout.value": "1000",
        "vout.scriptPubKey": "51",
    }

    assert calc.extract_tx_field([SAMPLE_TX_HEX, "version"]) == values["version"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "locktime"]) == values["locktime"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "input_count"]) == values["input_count"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "output_count"]) == values["output_count"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "vin.txid", "0"]) == values["vin.txid"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "vin.vout", "0"]) == values["vin.vout"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "vin.scriptSig", "0"]) == values["vin.scriptSig"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "vin.sequence", "0"]) == values["vin.sequence"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "vout.value", "0"]) == values["vout.value"]
    assert calc.extract_tx_field([SAMPLE_TX_HEX, "vout.scriptPubKey", "0"]) == values["vout.scriptPubKey"]


def test_extract_tx_field_reads_op_return_payloads_by_vout_index():
    raw_tx = build_tx_with_op_returns()
    long_payload = (b"\xff" * 80).hex()

    assert calc.extract_tx_field([raw_tx, "op_return.data", "1"]) == "48656c6c6f"
    assert calc.extract_tx_field([raw_tx, "op_return.data", "2"]) == long_payload


def test_extract_tx_field_rejects_missing_or_non_op_return_vout():
    raw_tx = build_tx_with_op_returns()

    with pytest.raises(ValueError, match="vout index 0 is not an OP_RETURN output"):
        calc.extract_tx_field([raw_tx, "op_return.data", "0"])

    with pytest.raises(IndexError, match="vout index 3 out of range"):
        calc.extract_tx_field([raw_tx, "op_return.data", "3"])


def test_compare_equal_and_numeric_parsers():
    assert calc.compare_equal(["a", "a", "a"]) == "true"
    assert calc.compare_equal(["a", "b"]) == "false"
    with pytest.raises(ValueError):
        calc.compare_equal(["only-one"])

    assert calc._parse_numeric_exact("0x10") == 16
    assert calc._parse_numeric_exact("10") == 10
    assert calc._parse_numeric_exact("1.5") == Decimal("1.5")
    assert calc._parse_numeric_exact("1e6") == Decimal("1e6")
    assert calc._parse_numeric_exact("1e8") == Decimal("1e8")
    assert calc._parse_numeric_exact("2.5e3") == Decimal("2.5e3")
    assert calc._parse_numeric_exact("deadbeef") == 0xDEADBEEF
    with pytest.raises(ValueError):
        calc._parse_numeric_exact("")

    a, b = calc._coerce_for_op(1, Decimal("2.5"))
    assert isinstance(a, Decimal) and isinstance(b, Decimal)
    assert calc._num_to_str(Decimal("1.500")) == "1.5"
    assert calc._num_to_str(Decimal("2.0")) == "2"


def test_compare_numbers_and_math_operations():
    assert calc.compare_numbers(["10", "<", "20"]) == "true"
    assert calc.compare_numbers(["10", ">", "20"]) == "false"
    assert calc.compare_numbers(["1e8", ">", "1000000"]) == "true"
    assert calc.compare_numbers(["1e6", "<=", "1000000"]) == "true"
    with pytest.raises(ValueError):
        calc.compare_numbers(["10", "!=", "20"])

    assert calc.math_operation(["10", "+", "5"]) == "15"
    assert calc.math_operation(["10", "-", "5"]) == "5"
    assert calc.math_operation(["10", "*", "5"]) == "50"
    assert calc.math_operation(["3", "/", "2"]) == "1.5"
    assert calc.math_operation(["1e8", "+", "1"]) == "100000001"
    assert calc.math_operation(["1e6", "*", "2"]) == "2000000"
    with pytest.raises(ValueError):
        calc.math_operation(["1", "/", "0"])

@pytest.mark.parametrize("raw", [
    "1e", "e10", "1E", "E10", "1e1e",
    "0b10", "0B10",
    # special Decimal values that must be rejected
    "NaN", "nan", "Infinity", "-Infinity", "sNaN",
    # underscore-separated numeric literals
    "_10", "1__0", "1_",
    # trailing dots – looks like a decimal but the fractional part is absent
    "123.", "0.",
    # malformed scientific notation: trailing dot before the exponent
    "1.e6", "0.e3",
])
def test_parse_numeric_exact_rejects_malformed(raw):
    with pytest.raises(ValueError):
        calc._parse_numeric_exact(raw)


@pytest.mark.parametrize("raw,expected", [
    ("fe1",   0xfe1),
    ("a1e4",  0xa1e4),
    ("b3e2f", 0xb3e2f),
    (".5e3",  Decimal(".5e3")),
    ("+1e6",  Decimal("+1e6")),
    ("-0.5",  Decimal("-0.5")),
    ("0e0",   Decimal("0e0")),
    ("0X1F",  0x1F),
    ("0xDEAD", 0xDEAD),
])
def test_parse_numeric_exact_accepts_valid(raw, expected):
    assert calc._parse_numeric_exact(raw) == expected


def test_parse_numeric_exact_malformed_propagates_to_api():
    with pytest.raises(ValueError):
        calc.compare_numbers(["1e", "<", "31"])
    with pytest.raises(ValueError):
        calc.math_operation(["e10", "+", "1"])


def test_hash160_and_sha256_address_helpers():
    p2pkh = calc.hash160_to_p2pkh_address(GENESIS_HASH160)
    assert calc.address_to_scriptpubkey(p2pkh) == "76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac"

    p2wpkh = calc.hash160_to_p2wpkh_address(GENESIS_HASH160)
    assert calc.address_to_scriptpubkey(p2wpkh) == "001462e907b15cbf27d5425399ebf6f0fb50ebb88f18"


def test_address_to_scriptpubkey_rejects_garbage():
    with pytest.raises(ValueError, match="Unrecognized address format"):
        calc.address_to_scriptpubkey("not-an-address")


def test_hex_byte_length():
    assert calc.hex_byte_length("00ff") == 2
    assert calc.hex_byte_length("") == 0
    assert calc.hex_byte_length("0xdeadbeef") == 4  # 0x prefix not counted


def test_hex_byte_length_rejects_non_hex():
    with pytest.raises(ValueError, match="not valid hexadecimal"):
        calc.hex_byte_length("zz")


def test_bip67_sort_pubkeys_and_check_result():
    keys = [
        "02" + "bb" * 32,
        "02" + "aa" * 32,
        "03" + "cc" * 32,
    ]
    assert calc.bip67_sort_pubkeys(keys) == "2,1,3"
    assert calc.bip67_sort_pubkeys([]) == ""

    assert calc.check_result(["true", "TRUE", ""]) == "true"
    assert calc.check_result(["false", "true"]) == "false"


def test_bip67_sort_pubkeys_rejects_invalid_inputs():
    uncompressed = "04" + "11" * 64 + "01"
    with pytest.raises(ValueError, match="33-byte compressed"):
        calc.bip67_sort_pubkeys([uncompressed])

    bad_prefix = "04" + "11" * 32
    with pytest.raises(ValueError, match="02 or 03"):
        calc.bip67_sort_pubkeys([bad_prefix])


def test_address_to_scriptpubkey_rejects_unknown_hrp():
    unknown_hrp_addr = calc._bech32_encode("zz", 0, bytes.fromhex(GENESIS_HASH160))
    with pytest.raises(ValueError, match="Unsupported HRP 'zz'"):
        calc.address_to_scriptpubkey(unknown_hrp_addr)


def test_address_to_scriptpubkey_rejects_unknown_base58_version():
    payload = bytes([0x10]) + bytes(20)
    exotic_addr = calc._b58check_encode(payload)
    with pytest.raises(ValueError, match="Unknown Base58 version byte: 0x10"):
        calc.address_to_scriptpubkey(exotic_addr)


def test_taproot_roundtrip_to_scriptpubkey():
    xonly = "11" * 32
    addr = calc._bech32_encode("bc", 1, bytes.fromhex(xonly))
    assert calc.address_to_scriptpubkey(addr) == "5120" + xonly


def test_future_witness_v2_builds_right_script():
    prog = "aabb"
    addr = calc._bech32_encode("tb", 2, bytes.fromhex(prog))
    assert calc.address_to_scriptpubkey(addr) == "5202" + prog


def test_bech32_mixed_case_rejected():
    mixed = "bc1Qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    with pytest.raises(ValueError):
        calc.address_to_scriptpubkey(mixed)


def test_bech32_v1_wrong_length_rejected():
    prog = "11" * 31
    addr = calc._bech32_encode("bc", 1, bytes.fromhex(prog))
    with pytest.raises(ValueError, match="Taproot"):
        calc.address_to_scriptpubkey(addr)

def test_bech32_v0_wrong_length_rejected(monkeypatch):
    def fake_decode(_addr):
        return "bc", 0, b"\x00" * 21

    monkeypatch.setattr(calc, "_bech32_decode", fake_decode)

    with pytest.raises(ValueError, match="v0 witness program must be 20 or 32 bytes"):
        calc.address_to_scriptpubkey("bc1qdummy")


def test_signet_hrp_alias_accepted():
    program = "22" * 20
    addr = calc._bech32_encode("tbs", 0, bytes.fromhex(program))
    assert calc.address_to_scriptpubkey(addr).startswith("0014")


def test_p2sh_p2wpkh_scriptpubkey():
    h160 = GENESIS_HASH160
    redeem = "0014" + h160
    rs_h160 = calc.hash160_hex(redeem)
    addr = calc.hash160_to_p2sh_address(rs_h160, "mainnet")
    assert calc.address_to_scriptpubkey(addr) == "a914" + rs_h160 + "87"


def test_p2sh_p2wsh_scriptpubkey():
    wsh = "00" * 32
    redeem = "0020" + wsh
    rs_h160 = calc.hash160_hex(redeem)
    addr = calc.hash160_to_p2sh_address(rs_h160, "mainnet")
    assert calc.address_to_scriptpubkey(addr) == "a914" + rs_h160 + "87"


def test_scriptpubkey_to_scriptcode_derives_p2wpkh_template():
    program = "ac5481e5be3e36c82a8db4340da410e1cffef479"
    expected = "76a914" + program + "88ac"
    assert calc.scriptpubkey_to_scriptcode("0014" + program) == expected
    # input hygiene: whitespace and case are normalized
    assert calc.scriptpubkey_to_scriptcode(" 0014" + program.upper() + "\n") == expected


def test_scriptpubkey_to_scriptcode_rejects_non_p2wpkh():
    with pytest.raises(ValueError, match="witnessScript itself"):
        calc.scriptpubkey_to_scriptcode("0020" + "ab" * 32)
    with pytest.raises(ValueError, match="Taproot has no scriptCode"):
        calc.scriptpubkey_to_scriptcode("5120" + "ab" * 32)
    with pytest.raises(ValueError, match="Not a P2WPKH scriptPubKey"):
        calc.scriptpubkey_to_scriptcode("76a914" + "11" * 20 + "88ac")
    with pytest.raises(ValueError, match="Not a P2WPKH scriptPubKey"):
        calc.scriptpubkey_to_scriptcode("0014" + "11" * 19)  # short program
    with pytest.raises(ValueError, match="cannot be empty"):
        calc.scriptpubkey_to_scriptcode("   ")


def test_script_verification_unknown_flag_raises():
    tx_hex = build_sample_tx_hex()
    with pytest.raises(ValueError, match="Unknown flag: 'NOPE'"):
        calc.script_verification(["", "51", tx_hex, 0, "NOPE"])


def test_script_verification_excluding_witness_clears_dependents():
    tx_hex = build_sample_tx_hex()
    result = json.loads(calc.script_verification(["", "51", tx_hex, 0, "WITNESS"]))
    assert set(result["excludedFlags"]) == {
        "CLEANSTACK",
        "DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM",
        "WITNESS",
        "WITNESS_PUBKEYTYPE",
    }
    assert "WITNESS_PUBKEYTYPE" not in result["activeFlags"]
    assert result["witnessRulesEnabled"] is False
    assert result["usesWitness"] is False
    # excluding WITNESS must still execute the script under pre-SegWit
    # rules, not fail on the CLEANSTACK => WITNESS flag dependency
    assert result["isValid"] is True


def test_script_verification_exposes_taproot_policy_flags():
    tx_hex = build_sample_tx_hex()
    result = json.loads(calc.script_verification(["", "51", tx_hex, 0, ""]))
    # the three Taproot policy flags are active AND disclosed in activeFlags
    for name in (
        "DISCOURAGE_UPGRADABLE_TAPROOT_VERSION",
        "DISCOURAGE_OP_SUCCESS",
        "DISCOURAGE_UPGRADABLE_PUBKEYTYPE",
    ):
        assert name in result["activeFlags"], name
    # and each can now be excluded by name instead of raising "Unknown flag"
    excluded = json.loads(
        calc.script_verification(["", "51", tx_hex, 0, "DISCOURAGE_OP_SUCCESS"])
    )
    assert "DISCOURAGE_OP_SUCCESS" in excluded["excludedFlags"]
    assert "DISCOURAGE_OP_SUCCESS" not in excluded["activeFlags"]
    assert excluded["isValid"] is True


def test_script_verification_excluding_taproot_clears_taproot_policy_flags():
    tx_hex = build_sample_tx_hex()
    result = json.loads(calc.script_verification(["", "51", tx_hex, 0, "TAPROOT"]))
    assert {
        "TAPROOT",
        "DISCOURAGE_UPGRADABLE_TAPROOT_VERSION",
        "DISCOURAGE_OP_SUCCESS",
        "DISCOURAGE_UPGRADABLE_PUBKEYTYPE",
    } <= set(result["excludedFlags"])
    assert "TAPROOT" not in result["activeFlags"]
    assert result["isValid"] is True


def test_script_verification_undisclosable_active_flag_fails_hard(monkeypatch):
    # If the library ever applies a verify flag that the derived display map
    # cannot name (e.g. the canonical table loses an entry the STANDARD set
    # still contains), verification must fail loudly — not silently hide the
    # flag from activeFlags. RuntimeError (not assert) so `python -O` cannot
    # strip the guard.
    tx_hex = build_sample_tx_hex()
    crippled = {
        name: value
        for name, value in calc.SCRIPT_VERIFY_FLAGS_BY_NAME.items()
        if name != "TAPROOT"
    }
    monkeypatch.setattr(calc, "SCRIPT_VERIFY_FLAGS_BY_NAME", crippled)
    with pytest.raises(RuntimeError, match="without a display name"):
        calc.script_verification(["", "51", tx_hex, 0, ""])


def _build_taproot_script_spend(script_ops, witness_stack, n_inputs, leaf="leaf"):
    """P2TR script-path spend: returns (scriptPubKey_hex, tx_hex); input 0
    carries [stack..., leaf script, control block], other inputs are empty."""
    from bitcointx.core import CTxWitness
    from bitcointx.core.script import TaprootScriptTree
    from bitcointx.wallet import CCoinKey, P2TRCoinAddress

    key = CCoinKey.from_secret_bytes(b"\x33" * 32)
    script = CScript(script_ops, name=leaf)
    tree = TaprootScriptTree([script], internal_pubkey=key.xonly_pub)
    committed, control = tree.get_script_with_control_block(leaf)
    spk = P2TRCoinAddress.from_script_tree(tree).to_scriptPubKey()
    vin = [
        CMutableTxIn(COutPoint(bytes([i + 1]) * 32, 0), CScript(), 0xFFFFFFFF)
        for i in range(n_inputs)
    ]
    wit = CTxWitness(
        [CTxInWitness(CScriptWitness(
            list(witness_stack) + [bytes(committed), control]))]
        + [CTxInWitness()] * (n_inputs - 1)
    )
    tx = CMutableTransaction(
        vin=vin, vout=[CMutableTxOut(1000, CScript([1]))], witness=wit
    )
    return b2x(spk), b2x(tx.serialize())


def test_script_verification_signatureless_tapscript_needs_no_prevouts():
    # B09 end-to-end: the library only needs prevouts when a Taproot sighash
    # is computed. A signatureless OP_1 tapscript on a MULTI-input tx must
    # verify without any prevouts (the old envelope-based preflight raised).
    from bitcointx.core.script import OP_1 as TAP_OP_1

    spk_hex, tx_hex = _build_taproot_script_spend([TAP_OP_1], [], n_inputs=2)
    result = json.loads(calc.script_verification(["", spk_hex, tx_hex, 0, ""]))
    assert result["isValid"] is True
    assert "TAPROOT" in result["activeFlags"]


def test_script_verification_tapscript_sigcheck_without_prevouts_raises():
    # A tapscript signature check DOES need prevouts: the library rejects
    # with the structural MISSING_SPENT_OUTPUTS code on the failing opcode
    # step, which the backend translates into the friendly prevouts error.
    from bitcointx.core.script import OP_CHECKSIG as TAP_OP_CHECKSIG

    spk_hex, tx_hex = _build_taproot_script_spend(
        [b"\x22" * 32, TAP_OP_CHECKSIG], [b"\x00" * 64], n_inputs=2
    )
    with pytest.raises(ValueError, match="vin-ordered prevouts"):
        calc.script_verification(["", spk_hex, tx_hex, 0, ""])


def test_script_verification_taproot_keypath_without_prevouts_raises():
    # Key-path spends always need prevouts; the library's validator event
    # carries MISSING_SPENT_OUTPUTS and gets the same friendly translation.
    from bitcointx.core import CTxWitness
    from bitcointx.wallet import CCoinKey, P2TRCoinAddress

    key = CCoinKey.from_secret_bytes(b"\x44" * 32)
    spk = P2TRCoinAddress.from_xonly_pubkey(key.xonly_pub).to_scriptPubKey()
    vin = [
        CMutableTxIn(COutPoint(bytes([i + 1]) * 32, 0), CScript(), 0xFFFFFFFF)
        for i in range(2)
    ]
    wit = CTxWitness(
        [CTxInWitness(CScriptWitness([b"\x00" * 64])), CTxInWitness()]
    )
    tx = CMutableTransaction(
        vin=vin, vout=[CMutableTxOut(1000, CScript([1]))], witness=wit
    )
    with pytest.raises(ValueError, match="vin-ordered prevouts"):
        calc.script_verification(["", b2x(spk), b2x(tx.serialize()), 0, ""])


def test_script_verification_empty_tapscript_is_valid_and_harvested():
    # An empty tapscript leaf is valid (nothing executes; the initial
    # witness stack decides). The harvested witnessScript key must be
    # PRESENT with "" so the viewer can tell it from a key-path spend.
    spk_hex, tx_hex = _build_taproot_script_spend([], [b"\x01"], n_inputs=1)
    result = json.loads(calc.script_verification(["", spk_hex, tx_hex, 0, ""]))
    assert result["isValid"] is True
    assert result["witnessScript"] == ""
    ws_events = [
        s for s in result["steps"] if s.get("step") == "witness_script"
    ]
    assert ws_events and ws_events[0]["committed"] is True
    assert ws_events[0]["executed"] is True


def test_script_verification_single_input_taproot_still_synthesizes_prevout():
    # The single-input educational convenience is preserved: with no
    # prevouts supplied, the one prevout is synthesized from the
    # scriptPubKey + amount, so verification runs (and the dummy signature
    # fails schnorr verification instead of raising a prevouts error).
    from bitcointx.core.script import OP_CHECKSIG as TAP_OP_CHECKSIG

    spk_hex, tx_hex = _build_taproot_script_spend(
        [b"\x22" * 32, TAP_OP_CHECKSIG], [b"\x00" * 64], n_inputs=1
    )
    result = json.loads(calc.script_verification(["", spk_hex, tx_hex, 0, ""]))
    assert result["isValid"] is False
    assert "schnorr" in (result.get("error") or "").lower()


def test_script_verification_legacy_false_spend_does_not_report_witness():
    tx_hex = build_sample_tx_hex()
    result = json.loads(calc.script_verification(["51", "00", tx_hex, 0, ""]))
    assert result["witnessRulesEnabled"] is True
    assert result["usesWitness"] is False
    assert result["isValid"] is False
    assert "requires the spent amount" not in result.get("error", "")


def test_script_verification_legacy_amount_is_not_witness_amount():
    tx_hex = build_sample_tx_hex()
    amount = 1234
    result = json.loads(
        calc.script_verification(["", "51", tx_hex, 0, "", str(amount)])
    )
    assert result["witnessRulesEnabled"] is True
    assert result["usesWitness"] is False
    assert "amountUsed" not in result


def test_script_verification_p2wsh_op_true_succeeds():
    tx, script_pubkey_hex, witness_script = build_p2wsh_op_true_tx()
    tx_hex = b2x(tx.serialize())

    result = json.loads(
        calc.script_verification(["", script_pubkey_hex, tx_hex, 0, "", "1000"])
    )

    assert result["isValid"] is True
    assert result["witnessRulesEnabled"] is True
    assert result["usesWitness"] is True
    assert any(step.get("phase") == "witnessScript" for step in result["steps"])
    assert result.get("amountUsed") == 1000

    # validator rule steps: pattern match, item load, hash-check
    validator_steps = [
        s.get("step") for s in result["steps"] if s.get("kind") == "validator"
    ]
    assert validator_steps == [
        "witness_program_match",
        "witness_load",
        "witness_script_check",
    ]
    check = next(
        s for s in result["steps"] if s.get("step") == "witness_script_check"
    )
    wsh = script_pubkey_hex[4:]
    assert check["sha256_hex"] == wsh
    assert check["program_hex"] == wsh
    # the hash-check pops the item; it becomes the executable witnessScript
    assert check["stack_before"] == [bytes(witness_script).hex()]
    assert check["stack_after"] == []
    assert result["witnessScript"] == bytes(witness_script).hex()
    assert "scriptCode" not in result


def test_script_verification_native_p2wpkh_traces_validator_steps():
    """Replay the official BIP143 'Native P2WPKH' example through the tracer.

    SegWit v0 traces interleave engine opcodes with validator rule steps
    (kind="validator"): the legacy scriptPubKey evaluation, the BIP141
    pattern match, per-item witness deserialization, and the BIP143
    scriptCode derivation — surfaced as `scriptCode`, not `witnessScript`.
    """
    unsigned_tx = (
        "0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f"
        "0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57"
        "b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85"
        "c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2"
        "f0167faa815988ac11000000"
    )
    program = "1d0f172a0ecb48aee1be1f2687d2963ae33f71a1"
    script_pubkey_hex = "0014" + program
    sig = (
        "304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a"
        "0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee01"
    )
    pubkey = "025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357"

    tx = CMutableTransaction.deserialize(bytes.fromhex(unsigned_tx))
    tx.wit.vtxinwit = (
        CTxInWitness(CScriptWitness([])),
        CTxInWitness(CScriptWitness([bytes.fromhex(sig), bytes.fromhex(pubkey)])),
    )

    result = json.loads(
        calc.script_verification(
            ["", script_pubkey_hex, b2x(tx.serialize()), 1, "", "600000000"]
        )
    )

    assert result["isValid"] is True
    assert result["scriptCode"] == "76a914" + program + "88ac"
    assert "witnessScript" not in result
    assert result["witnessStack"] == [sig, pubkey]

    steps = result["steps"]
    # engine opcodes: legacy scriptPubKey eval, then the scriptCode template
    assert [
        (s.get("phase"), s["opcode_name"])
        for s in steps
        if s.get("kind") != "validator"
    ] == [
        ("scriptPubKey", "OP_0"),
        ("scriptPubKey", "PUSH 20 bytes"),
        ("witnessScript", "OP_DUP"),
        ("witnessScript", "OP_HASH160"),
        ("witnessScript", "PUSH 20 bytes"),
        ("witnessScript", "OP_EQUALVERIFY"),
        ("witnessScript", "OP_CHECKSIG"),
    ]
    # validator rules, all in the "witness" phase
    validator = [s for s in steps if s.get("kind") == "validator"]
    assert [s.get("step") for s in validator] == [
        "witness_program_match",
        "witness_load",
        "witness_load",
        "scriptcode_derive",
    ]
    assert all(s.get("phase") == "witness" for s in validator)
    match = validator[0]
    assert match["program_hex"] == program
    load_one, load_two = validator[1], validator[2]
    assert (load_one["witness_index"], load_one["witness_total"]) == (0, 2)
    assert load_one["stack_before"] == [] and load_one["stack_after"] == [sig]
    assert load_two["stack_after"] == [sig, pubkey]
    derive = validator[3]
    assert derive["script_hex"] == result["scriptCode"]
    assert derive["program_hex"] == program
    # deriving the scriptCode does not touch the stack
    assert derive["stack_before"] == derive["stack_after"] == [sig, pubkey]


def test_script_verification_p2sh_wrapped_witness_reports_witness_use():
    witness_script = CScript([1])
    wsh = hashlib.sha256(bytes(witness_script)).hexdigest()
    redeem_hex = "0020" + wsh
    script_sig_hex = calc.encode_script_push_data(redeem_hex) + redeem_hex
    script_pubkey_hex = "a914" + calc.hash160_hex(redeem_hex) + "87"

    txin = CMutableTxIn(COutPoint(b"\x00" * 32, 0))
    txout = CMutableTxOut(0, CScript([0]))
    tx = CMutableTransaction(vin=[txin], vout=[txout])
    tx.wit.vtxinwit = (CTxInWitness(scriptWitness=CScriptWitness([bytes(witness_script)])),)

    result = json.loads(
        calc.script_verification([script_sig_hex, script_pubkey_hex, b2x(tx.serialize()), 0, "", "1000"])
    )

    assert result["isValid"] is True
    assert result["witnessRulesEnabled"] is True
    assert result["usesWitness"] is True
    assert result.get("amountUsed") == 1000
    assert any(step.get("phase") == "witnessScript" for step in result["steps"])


def test_script_verification_taproot_keypath_single_input():
    # Build a simple key-path Taproot spend: 1 input, signature only
    internal_sk = "11" * 32
    internal_xonly = json.loads(calc.xonly_pubkey_from_private_key(internal_sk))["xonly_pubkey"]
    output_xonly = calc.taproot_output_pubkey_from_xonly([internal_xonly])
    script_pubkey_hex = "5120" + output_xonly

    txin = CMutableTxIn(COutPoint(b"\x00" * 32, 0))
    txout = CMutableTxOut(0, CScript([0]))
    tx = CMutableTransaction(vin=[txin], vout=[txout])

    spent_outputs = [CMutableTxOut(5000, CScript(bytes.fromhex(script_pubkey_hex)))]
    sighash = SignatureHashSchnorr(tx, 0, spent_outputs)
    tweaked_sk = calc.taproot_tweaked_privkey([internal_sk])
    sig = bytes.fromhex(calc.schnorr_sign_bip340([tweaked_sk, sighash.hex()]))

    tx.wit.vtxinwit = (CTxInWitness(scriptWitness=CScriptWitness([sig])),)
    tx_hex = b2x(tx.serialize())

    result = json.loads(
        calc.script_verification(["", script_pubkey_hex, tx_hex, 0, "", "5000"])
    )

    assert result["isValid"] is True
    assert result["witnessRulesEnabled"] is True
    assert result["usesWitness"] is True
    assert result.get("amountUsed") == 5000


def test_encode_script_push_data_big_boundaries():
    assert calc.encode_script_push_data("00" * 75) == "4b"
    assert calc.encode_script_push_data("00" * 255) == "4cff"
    assert calc.encode_script_push_data("00" * 256) == "4d0001"
    assert calc.encode_script_push_data("00" * 65535) == "4dffff"
    assert calc.encode_script_push_data("00" * 65536) == "4e00000100"


def test_int_to_script_bytes_signbit_boundary():
    assert calc.int_to_script_bytes(127) == "7f"
    assert calc.int_to_script_bytes(128) == "8000"


def test_satoshi_to_8_le_extremes():
    assert calc.satoshi_to_8_le(0) == "0000000000000000"
    assert calc.satoshi_to_8_le(2**64 - 1) == "ffffffffffffffff"
    with pytest.raises(ValueError):
        calc.satoshi_to_8_le(-1)


def test_encode_varint_blank_and_none():
    assert calc.encode_varint("") == "00"
    assert calc.encode_varint(None) == "00"


def test_varint_encoded_byte_length_big_boundaries():
    assert calc.varint_encoded_byte_length("00" * 65535) == "fdffff"
    assert calc.varint_encoded_byte_length("00" * 65536) == "fe00000100"


def test_sha256_to_p2wsh_address_wrong_length():
    with pytest.raises(ValueError, match="SHA256 must be exactly 32 bytes"):
        calc.sha256_to_p2wsh_address("00" * 60, "mainnet")


def test_blocks_to_sequence_number_upper_bound():
    with pytest.raises(ValueError, match="Block delay must be <= 65535"):
        calc.blocks_to_sequence_number(65536)


def test_hex_byte_length_odd_rejected():
    with pytest.raises(ValueError, match=r"\*even\* number of hex characters"):
        calc.hex_byte_length("0ff")


def test_public_key_from_private_key_invalid_inputs():
    with pytest.raises(ValueError, match="exactly 32 bytes"):
        calc.public_key_from_private_key("00" * 31)
    with pytest.raises(ValueError, match=r"range \[1, n-1\]"):
        calc.public_key_from_private_key("00" * 32)
    with pytest.raises(ValueError, match=r"\*even\* number"):
        calc.public_key_from_private_key("abc")


def test_verify_signature_negative_case():
    sig = calc.sign_as_bitcoin_core_low_r([SAMPLE_PRIV_KEY, SAMPLE_MSG_HASH])
    pub = calc.public_key_from_private_key(SAMPLE_PRIV_KEY)
    bad_hash = "11" * 32
    assert calc.verify_signature([pub, bad_hash, sig]) == "false"


def test_verify_signature_invalid_der_raises():
    pub = calc.public_key_from_private_key(SAMPLE_PRIV_KEY)
    with pytest.raises(ValueError, match="Invalid DER signature"):
        calc.verify_signature([pub, SAMPLE_MSG_HASH, "30"])


def test_sign_verify_is_thread_safe():
    pub = calc.public_key_from_private_key(SAMPLE_PRIV_KEY)

    def _work(i: int) -> str:
        msg = f"{i:064x}"
        sig = calc.sign_as_bitcoin_core_low_r([SAMPLE_PRIV_KEY, msg])
        return calc.verify_signature([pub, msg, sig])

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(_work, range(32)))

    assert all(res == "true" for res in results)


def test_hours_to_sequence_number_ties_to_even():
    hours = (10.5 * 512.0) / 3600.0
    assert calc.hours_to_sequence_number(hours) == 10


@given(st.binary(min_size=1, max_size=64))
def test_b58check_roundtrip_fuzz(payload: bytes):
    encoded = calc._b58check_encode(payload)
    assert calc._b58check_decode(encoded) == payload


@st.composite
def _witness_programs(draw):
    hrp = draw(st.sampled_from(["bc", "tb", "bcrt"]))
    version = draw(st.integers(min_value=0, max_value=16))

    if version == 0:
        length = draw(st.sampled_from([20, 32]))
    elif version == 1:
        length = 32
    else:
        length = draw(st.integers(min_value=2, max_value=40))

    program = draw(st.binary(min_size=length, max_size=length))
    return hrp, version, program


@given(_witness_programs())
def test_bech32_roundtrip_property(params):
    hrp, version, program = params
    addr = calc._bech32_encode(hrp, version, program)
    decoded_hrp, decoded_version, decoded_prog = calc._bech32_decode(addr)
    assert decoded_hrp == hrp
    assert decoded_version == version
    assert bytes(decoded_prog) == program


@st.composite
def _hex_with_whitespace(draw):
    raw = draw(st.binary(min_size=0, max_size=32))
    if not raw:
        return ""
    chunks = [f"{byte:02x}" for byte in raw]
    separators = st.sampled_from(["", " ", "\n", "\t"])
    pieces = []
    for chunk in chunks:
        pieces.append(chunk + draw(separators))
    return "".join(pieces)


@given(_hex_with_whitespace())
def test_hex_byte_length_matches_python(hex_string: str):
    cleaned = "".join(hex_string.split())
    expected = len(cleaned) // 2
    assert calc.hex_byte_length(hex_string) == expected


def test_ecdsa_signing_is_deterministic_canary():
    """Signing the same sighash with the same key twice must be bit-identical.

    The committed lesson goldens (src/my_tx_flows/*.json) pin exact DER
    signature bytes, which only works because both ECDSA signing paths derive
    their nonce deterministically via RFC6979 from (key, message). If this
    canary fails, a randomized nonce crept in and every signature golden in
    the flow corpus becomes unreproducible.
    """
    for signer in (calc.sign_tx_rfc6979, calc.sign_as_bitcoin_core_low_r):
        first = signer([SAMPLE_PRIV_KEY, SAMPLE_MSG_HASH])
        second = signer([SAMPLE_PRIV_KEY, SAMPLE_MSG_HASH])
        assert first == second, (
            f"{signer.__name__} produced two different signatures for the "
            "same key and sighash. ECDSA nonces must come from RFC6979 so the "
            "flow goldens stay reproducible."
        )


def test_schnorr_signing_is_deterministic_canary():
    """BIP340 signing must be deterministic for a fixed (key, msg, aux_rand).

    schnorr_sign_bip340 defaults aux_rand to 32 zero bytes precisely so that
    the taproot lesson goldens pin stable signatures; a randomized aux_rand
    would invalidate them on every recalculation.
    """
    msg = "11" * 32
    assert calc.schnorr_sign_bip340([SAMPLE_PRIV_KEY, msg]) == (
        calc.schnorr_sign_bip340([SAMPLE_PRIV_KEY, msg])
    ), "BIP340 signing with the default aux_rand is not deterministic"

    aux = "22" * 32
    assert calc.schnorr_sign_bip340([SAMPLE_PRIV_KEY, msg, aux]) == (
        calc.schnorr_sign_bip340([SAMPLE_PRIV_KEY, msg, aux])
    ), "BIP340 signing with an explicit aux_rand is not deterministic"


def test_bip143_native_p2wpkh_official_vectors():
    """Replay the official BIP143 'Native P2WPKH' example.

    The flows build segwit v0 sighashes from these exact primitives
    (double_sha256_hex over concatenated fields), so the BIP's published
    intermediate hashes, sighash, and signature pin the whole path.
    """
    hash_prevouts = calc.double_sha256_hex(
        "fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f00000000"
        "ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000"
    )
    assert hash_prevouts == (
        "96b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37"
    )

    hash_sequence = calc.double_sha256_hex("eeffffff" + "ffffffff")
    assert hash_sequence == (
        "52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b"
    )

    hash_outputs = calc.double_sha256_hex(
        "202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac"
        "9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac"
    )
    assert hash_outputs == (
        "863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5"
    )

    preimage = calc.concat_all([
        "01000000",  # nVersion
        hash_prevouts,
        hash_sequence,
        # outpoint of the P2WPKH input being signed
        "ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000",
        "1976a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac",  # scriptCode
        "0046c32300000000",  # amount: 6 BTC
        "ffffffff",  # nSequence
        hash_outputs,
        "11000000",  # nLockTime
        calc.sighash_type_to_le4("01"),  # SIGHASH_ALL
    ])
    assert preimage == (
        "0100000096b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37"
        "52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b"
        "ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000"
        "1976a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac0046c32300000000"
        "ffffffff863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5"
        "1100000001000000"
    )

    sighash = calc.double_sha256_hex(preimage)
    assert sighash == (
        "c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670"
    )

    private_key = "619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9"
    public_key = "025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357"
    expected_der = (
        "304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a"
        "0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee"
    )
    # The BIP's signature is plain RFC6979 + low-S; its R already starts below
    # 0x80, so the low-R grinding path must return the identical signature.
    assert calc.sign_tx_rfc6979([private_key, sighash]) == expected_der
    assert calc.sign_as_bitcoin_core_low_r([private_key, sighash]) == expected_der
    assert calc.verify_signature([public_key, sighash, expected_der]) == "true"


def test_bip341_taproot_sighash_default_official_vector():
    """Replay the official BIP341 wallet test vector (keyPathSpending).

    Input index 4 is the only one signed with hashType 0x00 (SIGHASH_DEFAULT),
    which is the mode taproot_sighash_default implements. The published
    intermediate hashes cover every sub-hash the function returns.
    """
    raw_unsigned_tx = (
        "02000000097de20cbff686da83a54981d2b9bab3586f4ca7e48f57f5b55963115f3b33"
        "4e9c010000000000000000d7b7cab57b1393ace2d064f4d4a2cb8af6def61273e12751"
        "7d44759b6dafdd990000000000fffffffff8e1f583384333689228c5d28eac13366be0"
        "82dc57441760d957275419a418420000000000fffffffff0689180aa63b30cb162a73c"
        "6d2a38b7eeda2a83ece74310fda0843ad604853b0100000000feffffffaa5202bdf6d8"
        "ccd2ee0f0202afbbb7461d9264a25e5bfd3c5a52ee1239e0ba6c0000000000feffffff"
        "956149bdc66faa968eb2be2d2faa29718acbfe3941215893a2a3446d32acd050000000"
        "000000000000e664b9773b88c09c32cb70a2a3e4da0ced63b7ba3b22f848531bbb1d5d"
        "5f4c94010000000000000000e9aa6b8e6c9de67619e6a3924ae25696bb7b694bb677a6"
        "32a74ef7eadfd4eabf0000000000ffffffffa778eb6a263dc090464cd125c466b5a996"
        "67720b1c110468831d058aa1b82af10100000000ffffffff0200ca9a3b000000001976"
        "a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac807840cb0000000020ac9a"
        "87f5594be208f8532db38cff670c450ed2fea8fcdefcc9a663f78bab962b0065cd1d"
    )
    amounts = json.dumps([
        420000000,
        462000000,
        294000000,
        504000000,
        630000000,
        378000000,
        672000000,
        546000000,
        588000000,
    ])
    script_pubkeys = json.dumps([
        "512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343",
        "5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3",
        "76a914751e76e8199196d454941c45d1b3a323f1433bd688ac",
        "5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e",
        "512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605",
        "00147dd65592d0ab2fe0d0257d571abf032cd9db93dc",
        "512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831",
        "5120712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5",
        "512077e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220",
    ])

    res = json.loads(
        calc.taproot_sighash_default([raw_unsigned_tx, 4, amounts, script_pubkeys])
    )

    assert res["sha_prevouts"] == (
        "e3b33bb4ef3a52ad1fffb555c0d82828eb22737036eaeb02a235d82b909c4c3f"
    )
    assert res["sha_amounts"] == (
        "58a6964a4f5f8f0b642ded0a8a553be7622a719da71d1f5befcefcdee8e0fde6"
    )
    assert res["sha_scriptpubkeys"] == (
        "23ad0f61ad2bca5ba6a7693f50fce988e17c3780bf2b1e720cfbb38fbdd52e21"
    )
    assert res["sha_sequences"] == (
        "18959c7221ab5ce9e26c3cd67b22c24f8baa54bac281d8e6b05e400e6c3a957e"
    )
    assert res["sha_outputs"] == (
        "a2e6dab7c1f0dcd297c8d61647fd17d821541ea69c3cc37dcbad7f90d4eb4bc5"
    )
    assert res["sighash"] == (
        "4f900a0bae3f1446fd48490c2958b5a023228f01661cda3496a11da502a7f7ef"
    )
