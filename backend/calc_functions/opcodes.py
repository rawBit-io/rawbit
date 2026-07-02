"""Bitcoin Script opcode catalogue used by backend calculations."""

from collections.abc import Mapping, Sequence
from typing import Any


OPCODE_TO_HEX = {
    # Common aliases / templates used by the UI.
    "OP_DUP": "76",
    "OP_HASH160": "a9",
    "OP_EQUALVERIFY": "88",
    "OP_CHECKSIG": "ac",
    "OP_EQUAL": "87",
    "OP_RETURN": "6a",
    "OP_0": "00",
    "OP_1": "51",
    "OP_2": "52",
    "OP_3": "53",
    "OP_CHECKMULTISIG": "ae",
    "P2PKH_PREFIX": "76a914",
    "P2PKH_SUFFIX": "88ac",
    "P2SH_PREFIX": "a914",
    "P2SH_SUFFIX": "87",
    "P2WPKH_REDEEM": "0014",
    "P2WSH_REDEEM": "0020",
    "P2TR_PREFIX": "5120",
    "OP_RETURN_PREFIX": "6a",
    "2OF3_MULTISIG_PREFIX": "5221",
    "2OF3_MULTISIG_SUFFIX": "53ae",
    "OP_0 / OP_FALSE": "00",
    "OP_1NEGATE": "4f",
    "OP_1 / OP_TRUE": "51",
    "OP_4": "54",
    "OP_5": "55",
    "OP_6": "56",
    "OP_7": "57",
    "OP_8": "58",
    "OP_9": "59",
    "OP_10": "5a",
    "OP_11": "5b",
    "OP_12": "5c",
    "OP_13": "5d",
    "OP_14": "5e",
    "OP_15": "5f",
    "OP_16": "60",
    "OP_NOP": "61",
    "OP_IF": "63",
    "OP_NOTIF": "64",
    "OP_ELSE": "67",
    "OP_ENDIF": "68",
    "OP_VERIFY": "69",
    "OP_TOALTSTACK": "6b",
    "OP_FROMALTSTACK": "6c",
    "OP_2DROP": "6d",
    "OP_2DUP": "6e",
    "OP_3DUP": "6f",
    "OP_2OVER": "70",
    "OP_2ROT": "71",
    "OP_2SWAP": "72",
    "OP_IFDUP": "73",
    "OP_DEPTH": "74",
    "OP_DROP": "75",
    "OP_NIP": "77",
    "OP_OVER": "78",
    "OP_PICK": "79",
    "OP_ROLL": "7a",
    "OP_ROT": "7b",
    "OP_SWAP": "7c",
    "OP_TUCK": "7d",
    "OP_SIZE": "82",
    "OP_1ADD": "8b",
    "OP_1SUB": "8c",
    "OP_NEGATE": "8f",
    "OP_ABS": "90",
    "OP_NOT": "91",
    "OP_0NOTEQUAL": "92",
    "OP_ADD": "93",
    "OP_SUB": "94",
    "OP_BOOLAND": "9a",
    "OP_BOOLOR": "9b",
    "OP_NUMEQUAL": "9c",
    "OP_NUMEQUALVERIFY": "9d",
    "OP_NUMNOTEQUAL": "9e",
    "OP_LESSTHAN": "9f",
    "OP_GREATERTHAN": "a0",
    "OP_LESSTHANOREQUAL": "a1",
    "OP_GREATERTHANOREQUAL": "a2",
    "OP_MIN": "a3",
    "OP_MAX": "a4",
    "OP_WITHIN": "a5",
    "OP_RIPEMD160": "a6",
    "OP_SHA1": "a7",
    "OP_SHA256": "a8",
    "OP_HASH256": "aa",
    "OP_CODESEPARATOR": "ab",
    "OP_CHECKSIGVERIFY": "ad",
    "OP_CHECKMULTISIGVERIFY": "af",
    "OP_CHECKSIGADD": "ba",
    "OP_CHECKLOCKTIMEVERIFY": "b1",
    "OP_CHECKSEQUENCEVERIFY": "b2",
    "OP_NOP1": "b0",
    "OP_NOP4": "b3",
    "OP_NOP5": "b4",
    "OP_NOP6": "b5",
    "OP_NOP7": "b6",
    "OP_NOP8": "b7",
    "OP_NOP9": "b8",
    "OP_NOP10": "b9",
    # Disabled (2010) and reserved opcodes — kept so disassembly can name them.
    "OP_RESERVED": "50",
    "OP_VER": "62",
    "OP_VERIF": "65",
    "OP_VERNOTIF": "66",
    "OP_CAT": "7e",
    "OP_SUBSTR": "7f",
    "OP_LEFT": "80",
    "OP_RIGHT": "81",
    "OP_INVERT": "83",
    "OP_AND": "84",
    "OP_OR": "85",
    "OP_XOR": "86",
    "OP_RESERVED1": "89",
    "OP_RESERVED2": "8a",
    "OP_2MUL": "8d",
    "OP_2DIV": "8e",
    "OP_MUL": "95",
    "OP_DIV": "96",
    "OP_MOD": "97",
    "OP_LSHIFT": "98",
    "OP_RSHIFT": "99",
}


def _ordered_values(vals: Any) -> list[Any]:
    if isinstance(vals, Mapping):
        return [
            vals[key]
            for key in sorted(
                vals.keys(),
                key=lambda k: int(k) if str(k).lstrip("-").isdigit() else str(k),
            )
        ]
    if isinstance(vals, str):
        return [vals]
    if isinstance(vals, Sequence):
        return list(vals)
    raise ValueError("Opcode sequence must be a list of opcode names")


def opcode_sequence_to_hex(vals: Any) -> str:
    """Convert ordered opcode names to their concatenated script hex."""
    chunks: list[str] = []

    for raw_name in _ordered_values(vals):
        name = "" if raw_name is None else str(raw_name).strip()
        if not name:
            continue

        hex_value = OPCODE_TO_HEX.get(name) or OPCODE_TO_HEX.get(name.upper())
        if hex_value is None:
            raise ValueError(f"Unknown opcode '{name}'")

        chunks.append(hex_value)

    return "".join(chunks)
