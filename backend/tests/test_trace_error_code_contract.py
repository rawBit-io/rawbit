"""Cross-layer contract: curated error_code explanations track the library.

The trace viewer (src/components/dialog/ScriptExecutionSteps.tsx) keys human
explanations off the ``error_code`` strings the pinned python-bitcointx fork
emits on terminal trace-failure steps. The fork freezes that vocabulary in
``bitcointx.core.scripteval._TRACE_ERROR_CODE_MACHINE_NAMES`` (guarded by its
own ``test_trace_error_code_vocabulary_is_frozen``). This test pins the
frontend map to that vocabulary, so a fork-side code rename/removal or a
frontend typo fails here instead of silently degrading a failure step to an
unexplained gloss.

Mirrors test_script_viewer.py, which locks the Python and TS opcode-name maps
to a shared fixture the same way.
"""

import re
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")

from bitcointx.core.scripteval import _TRACE_ERROR_CODE_MACHINE_NAMES

_VIEWER_TSX = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "components"
    / "dialog"
    / "ScriptExecutionSteps.tsx"
)


def _frontend_error_codes() -> set:
    source = _VIEWER_TSX.read_text()
    match = re.search(
        r"const ERROR_CODE_EXPLAIN: Record<string, string> = \{(.*?)\n\};",
        source,
        re.S,
    )
    assert match, "ERROR_CODE_EXPLAIN map not found in ScriptExecutionSteps.tsx"
    # Keys sit at exactly two spaces of indentation; wrapped explanation
    # strings are indented further and never match.
    return set(re.findall(r"^ {2}([A-Z][A-Z0-9_]*):", match.group(1), re.M))


def test_curated_error_codes_exist_in_library_vocabulary():
    frontend = _frontend_error_codes()
    assert frontend, "ERROR_CODE_EXPLAIN parsed as empty; extraction regex broke"
    unknown = frontend - set(_TRACE_ERROR_CODE_MACHINE_NAMES)
    assert not unknown, (
        "ERROR_CODE_EXPLAIN curates codes the pinned python-bitcointx fork "
        f"can never emit (typo or fork-side rename?): {sorted(unknown)}"
    )
