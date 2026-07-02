# Builds an "educational" code view by prepending helper code and constants
# when referenced by the function.

from __future__ import annotations

import ast
import inspect
import re
from pprint import pformat
from typing import Optional, Union, Type, Any
from types import (
    ModuleType,
    FunctionType,
    MethodType,
    TracebackType,
    FrameType,
    CodeType,
)

from calc_functions import calc_func as calc_ops
from calc_functions import opcodes as opcode_ops

# Objects inspect.getsource accepts (mirrors inspect internals closely)
SourceObject = Union[
    ModuleType,
    Type[Any],       # classes / types
    MethodType,
    FunctionType,
    TracebackType,
    FrameType,
    CodeType,
]

# Helper names we consider part of the address/encoding lib
_BASE58_HELPERS = [
    "_b58encode",
    "_b58decode",
    "_b58check_encode",
    "_b58check_decode",
]
_BECH32_HELPERS = [
    "_bech32_hrp_expand",
    "_bech32_polymod",
    "_bech32_create_checksum",
    "_convertbits",
    "_bech32_encode",
    "_bech32_decode",
    "_hrp_for_network",
]
# Symbols that actually consult the wordlist; generic crypto helpers like
# _hmac_sha512 are covered by the local-helper block instead.
_BIP39_WORDLIST_SYMBOLS = [
    "_BIP39_ENGLISH_WORDLIST",
    "_BIP39_ENGLISH_INDEX",
    "_bip39_mnemonic_to_entropy",
]

# Regex that detects usage of any helper name in the function source
_HELPER_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, _BASE58_HELPERS + _BECH32_HELPERS)) + r")\b"
)
_BIP39_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, _BIP39_WORDLIST_SYMBOLS)) + r")\b"
)
_OPCODE_SEQUENCE_HELPERS = ["_ordered_values", "opcode_sequence_to_hex"]

_MAX_HELPER_EXPANSION_DEPTH = 8


def _get_source(fn: Optional[SourceObject]) -> Optional[str]:
    """Safely get source for a supported object; return None if not available."""
    if fn is None:
        return None
    try:
        src = inspect.getsource(fn)
    except Exception:
        return None
    return src.strip()


def _base58_bundle() -> str:
    parts = []
    # Constants pulled live so they match runtime
    if hasattr(calc_ops, "_B58_ALPHABET"):
        parts.append(f'_B58_ALPHABET = "{calc_ops._B58_ALPHABET}"')
        parts.append("_B58_IDX = {c: i for i, c in enumerate(_B58_ALPHABET)}")
    # Functions (live source from calc_ops)
    for name in _BASE58_HELPERS:
        src = _get_source(getattr(calc_ops, name, None))
        if src:
            parts.append(src)
    return "\n\n".join(parts).strip()


def _bech32_bundle() -> str:
    parts = []
    if hasattr(calc_ops, "_BECH32_CHARSET"):
        parts.append(f'_BECH32_CHARSET = "{calc_ops._BECH32_CHARSET}"')
        parts.append("_BECH32_IDX = {c: i for i, c in enumerate(_BECH32_CHARSET)}")
    if hasattr(calc_ops, "_BECH32M_CONST"):
        parts.append(f"_BECH32M_CONST = {calc_ops._BECH32M_CONST}")
    for name in _BECH32_HELPERS:
        src = _get_source(getattr(calc_ops, name, None))
        if src:
            parts.append(src)
    return "\n\n".join(parts).strip()


def _bip39_wordlist_bundle() -> str:
    words = getattr(calc_ops, "_BIP39_ENGLISH_WORDLIST", [])
    if not words:
        return ""

    parts = [
        "# BIP39 English wordlist: indexes 0..2047, one 11-bit value per word.",
        "_BIP39_ENGLISH_WORDLIST = [",
    ]
    parts.extend(f'    "{word}",' for word in words)
    parts.append("]")
    parts.append(
        "_BIP39_ENGLISH_INDEX = {"
        "word: index for index, word in enumerate(_BIP39_ENGLISH_WORDLIST)"
        "}"
    )
    return "\n".join(parts).strip()


def _opcode_sequence_bundle(include_seq_helpers: bool = True) -> str:
    """
    Build a readable source block for opcode-catalogue-based nodes.

    Runtime keeps the opcode catalogue in calc_functions/opcodes.py. Always
    inline OPCODE_TO_HEX; only include the sequence-conversion helpers
    (_ordered_values / opcode_sequence_to_hex) when the node actually uses them
    (the Opcode Sequence node), so unrelated nodes like Script Viewer aren't
    padded with conversion code they never call.
    """
    parts = [
        "# Bitcoin Script opcode/template names accepted by this node.",
        "OPCODE_TO_HEX = " + pformat(opcode_ops.OPCODE_TO_HEX, width=88, sort_dicts=False),
    ]
    if include_seq_helpers:
        for name in _OPCODE_SEQUENCE_HELPERS:
            src = _get_source(getattr(opcode_ops, name, None))
            if src:
                parts.append(src)
    return "\n\n".join(parts).strip()


def _extract_called_names(source: str) -> list[str]:
    """
    Parse source and return called symbol names in first-seen order.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    ordered: list[str] = []
    seen: set[str] = set()

    class _CallVisitor(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call) -> None:
            name: Optional[str] = None
            if isinstance(node.func, ast.Name):
                name = node.func.id
            elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                # Support rare explicit module calls: calc_ops._helper(...)
                if node.func.value.id == "calc_ops":
                    name = node.func.attr

            if name and name not in seen:
                seen.add(name)
                ordered.append(name)

            self.generic_visit(node)

    _CallVisitor().visit(tree)
    return ordered


def _resolve_local_helper(name: str) -> Optional[FunctionType]:
    """
    Resolve top-level helper functions from calc_func by name.
    """
    if not name.startswith("_"):
        return None
    candidate = getattr(calc_ops, name, None)
    if not inspect.isfunction(candidate):
        return None
    if getattr(candidate, "__module__", "") != calc_ops.__name__:
        return None
    return candidate


def _collect_local_helpers(func_source: str) -> list[tuple[str, str]]:
    """
    Recursively collect local helper sources referenced by func_source.

    - Dedupe: each helper included once.
    - Stable order: source-call order + DFS post-order (deps first).
    - Cycle guard: via `visiting`.
    - Depth cap: `_MAX_HELPER_EXPANSION_DEPTH`.
    """
    ordered: list[tuple[str, str]] = []
    seen: set[str] = set()
    visiting: set[str] = set()

    def visit(name: str, depth: int) -> None:
        if name in seen or name in visiting:
            return
        if depth > _MAX_HELPER_EXPANSION_DEPTH:
            return

        fn = _resolve_local_helper(name)
        if fn is None:
            return

        src = _get_source(fn)
        if not src:
            return

        visiting.add(name)
        for called in _extract_called_names(src):
            visit(called, depth + 1)
        visiting.remove(name)

        seen.add(name)
        ordered.append((name, src))

    for called in _extract_called_names(func_source):
        visit(called, 1)

    return ordered


def expand_function_source(_func_obj: SourceObject, func_source: str) -> str:
    """
    If the given function's source mentions known educational helper bundles
    such as Base58, Bech32, or BIP39, return an expanded block with helper code
    and constants prepended.
    Otherwise return the original source unchanged.
    """
    source = func_source or ""
    direct_uses = set(_HELPER_PATTERN.findall(source))

    helper_entries = _collect_local_helpers(source)
    helper_names = [name for name, _ in helper_entries]
    helper_name_set = set(helper_names)

    uses_base58 = bool(direct_uses.intersection(_BASE58_HELPERS)) or bool(
        helper_name_set.intersection(_BASE58_HELPERS)
    )
    uses_bech32 = bool(direct_uses.intersection(_BECH32_HELPERS)) or bool(
        helper_name_set.intersection(_BECH32_HELPERS)
    )
    uses_bip39 = (
        bool(_BIP39_PATTERN.search(source))
        or "_bip39_mnemonic_to_entropy" in helper_name_set
        or any("_BIP39_ENGLISH_" in src for _, src in helper_entries)
    )
    # Any function that references the opcode catalogue — directly or through a
    # collected helper (e.g. script_viewer's _script_opcode_name_by_byte) —
    # needs OPCODE_TO_HEX inlined so the displayed reference source is
    # self-contained.
    references_opcode_catalogue = "OPCODE_TO_HEX" in source or any(
        "OPCODE_TO_HEX" in src for _, src in helper_entries
    )
    uses_opcode_sequence = (
        getattr(_func_obj, "__name__", "") == "op_code_select"
        or "opcode_sequence_to_hex" in source
        or references_opcode_catalogue
    )

    # Keep existing Base58/Bech32 bundle behavior (includes constants),
    # but avoid duplicate helper definitions in generic helper block.
    generic_helpers: list[str] = []
    for name, src in helper_entries:
        if uses_base58 and name in _BASE58_HELPERS:
            continue
        if uses_bech32 and name in _BECH32_HELPERS:
            continue
        generic_helpers.append(src)

    if (
        not uses_base58
        and not uses_bech32
        and not uses_bip39
        and not uses_opcode_sequence
        and not generic_helpers
    ):
        return func_source

    blocks = [
        "# --- Expanded view: helper code inlined for educational purposes ---",
    ]

    if uses_base58:
        b58 = _base58_bundle()
        if b58:
            blocks.append("# --- Base58 / Base58Check helpers ---\n" + b58)

    if uses_bech32:
        b32 = _bech32_bundle()
        if b32:
            blocks.append("# --- Bech32 / Bech32m helpers ---\n" + b32)

    if uses_bip39:
        bip39_words = _bip39_wordlist_bundle()
        if bip39_words:
            blocks.append("# --- BIP39 English wordlist ---\n" + bip39_words)

    if uses_opcode_sequence:
        include_seq_helpers = (
            getattr(_func_obj, "__name__", "") == "op_code_select"
            or "opcode_sequence_to_hex" in source
        )
        opcode_sequence = _opcode_sequence_bundle(include_seq_helpers)
        if opcode_sequence:
            label = (
                "# --- Opcode sequence conversion ---\n"
                if include_seq_helpers
                else "# --- Opcode catalogue ---\n"
            )
            blocks.append(label + opcode_sequence)

    if generic_helpers:
        blocks.append("# --- Local helper functions ---\n" + "\n\n".join(generic_helpers))

    blocks.append("# --- Node function ---\n" + source)
    return "\n\n".join(blocks)
