"""Low-level factory for rawBit flow JSON.

Emits nodes and edges in exactly the shape the hand-authored lessons use
(verified against p0/p1): ``calculation`` nodes with the engine's
param-extraction contracts, ``shadcnTextInfo`` cards, and ``input-<index>``
target handles. Layout policy lives in the callers — this module only knows
the data contracts.
"""

from __future__ import annotations

# Lesson color language (sampled from p1_Intro_P2PKH_and_P2PK):
TEAL = "#14b8a6"    # field constants & generic byte transforms
YELLOW = "#eab308"  # signing / preimage / scriptSig cluster
PURPLE = "#a855f7"  # final assembly, verification, txid, proof

SENTINEL_EMPTY = "__EMPTY__"
SENTINEL_FORCE00 = "__FORCE00__"

# Field offsets inside the TX spine (concat_all), as used by every lesson:
SPINE_INPUT_BASE = 1000
SPINE_OUTPUT_BASE = 3000
SPINE_STRIDE = 100
SPINE_IN_TXID = 0
SPINE_IN_VOUT = 10
SPINE_IN_SCRIPT_LEN = 20
SPINE_IN_SCRIPT_SIG = 30
SPINE_IN_SEQUENCE = 40
SPINE_OUT_AMOUNT = 0
SPINE_OUT_SPK_LEN = 10
SPINE_OUT_SPK = 20
SPINE_OUTPUT_COUNT = 2000
SPINE_LOCKTIME = 4000


class FlowBuilder:
    """Accumulates nodes/edges and renders the final FlowData dict."""

    def __init__(self, id_prefix: str = "rb"):
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self._prefix = id_prefix
        self._node_seq = 0
        self._edge_seq = 0

    # ── id helpers ───────────────────────────────────────────────────────────
    def _nid(self) -> str:
        self._node_seq += 1
        return f"node_{self._prefix}{self._node_seq:04d}"

    def _eid(self) -> str:
        self._edge_seq += 1
        return f"edge_{self._prefix}{self._edge_seq:04d}"

    # ── nodes ────────────────────────────────────────────────────────────────
    def identity(
        self,
        title: str,
        value: str,
        x: float,
        y: float,
        color: str = TEAL,
        label: str = "INPUT VALUE:",
        rows: int = 1,
    ) -> str:
        """A constant the user can edit; the whole flow recomputes from it."""
        nid = self._nid()
        self.nodes.append(
            {
                "id": nid,
                "type": "calculation",
                "position": {"x": x, "y": y},
                "data": {
                    "functionName": "identity",
                    "showField": True,
                    "numInputs": 0,
                    "value": value,
                    "dirty": False,
                    "version": 0,
                    "inputs": {"val": value},
                    "result": value,
                    "inputStructure": {
                        "ungrouped": [{"index": 0, "label": label, "rows": rows}]
                    },
                    "groupInstances": {},
                    "borderColor": color,
                    "title": title,
                    "error": False,
                },
            }
        )
        return nid

    def fn(
        self,
        function_name: str,
        title: str,
        x: float,
        y: float,
        color: str = TEAL,
    ) -> str:
        """A single-input transform node (uint32→LE4, varint, sha256d, …)."""
        nid = self._nid()
        self.nodes.append(
            {
                "id": nid,
                "type": "calculation",
                "position": {"x": x, "y": y},
                "data": {
                    "functionName": function_name,
                    "title": title,
                    "numInputs": 1,
                    "showField": False,
                    "value": "",
                    "dirty": False,
                    "version": 0,
                    "groupInstances": {},
                    "inputs": {"val": ""},
                    "result": "",
                    "borderColor": color,
                    "error": False,
                },
            }
        )
        return nid

    def op_codes(self, names: list[str], hex_value: str, x: float, y: float) -> str:
        """An opcode-sequence constant (e.g. OP_DUP OP_HASH160 → '76a9')."""
        nid = self._nid()
        self.nodes.append(
            {
                "id": nid,
                "type": "calculation",
                "position": {"x": x, "y": y},
                "data": {
                    "functionName": "op_code_select",
                    "value": hex_value,
                    "inputs": {"val": hex_value},
                    "dirty": False,
                    "version": 0,
                    "result": hex_value,
                    "groupInstances": {},
                    "paramExtraction": "single_val",
                    "title": "Opcode Sequence",
                    "opSequenceNames": list(names),
                    "borderColor": TEAL,
                    "error": False,
                },
            }
        )
        return nid

    def multi(
        self,
        function_name: str,
        title: str,
        fields: list[dict],
        x: float,
        y: float,
        color: str = TEAL,
        static_vals: dict[int, str] | None = None,
    ) -> str:
        """A flat multi-input node (concat_all, script_verification, …).

        ``fields``: [{"index": int, "label": str, "rows": int}, …] — the
        engine orders vals by ascending index. ``static_vals`` pre-fills
        fields that have no incoming cable (including sentinels), keyed by
        field index.
        """
        nid = self._nid()
        vals = {str(k): v for k, v in (static_vals or {}).items()}
        self.nodes.append(
            {
                "id": nid,
                "type": "calculation",
                "position": {"x": x, "y": y},
                "data": {
                    "functionName": function_name,
                    "title": title,
                    "paramExtraction": "multi_val",
                    "numInputs": len(fields),
                    "totalInputs": len(fields),
                    "unwiredCount": 0,
                    "showField": False,
                    "dirty": False,
                    "version": 0,
                    "inputs": {"vals": vals},
                    "result": "",
                    "inputStructure": {
                        "ungrouped": [dict(f) for f in fields],
                        "afterGroups": [],
                        "betweenGroups": {},
                        "groups": [],
                    },
                    "groupInstances": {},
                    "groupInstanceKeys": {},
                    "borderColor": color,
                    "error": False,
                },
            }
        )
        return nid

    def concat(
        self,
        title: str,
        labels: list[str],
        x: float,
        y: float,
        color: str = TEAL,
        static_vals: dict[int, str] | None = None,
    ) -> str:
        """A small concat_all whose fields use the lesson stride (0,100,200…)."""
        fields = [
            {"index": i * 100, "label": lbl, "rows": 1}
            for i, lbl in enumerate(labels)
        ]
        return self.multi(
            "concat_all", title, fields, x, y, color, static_vals=static_vals
        )

    def tx_spine(
        self,
        title: str,
        n_inputs: int,
        n_outputs: int,
        x: float,
        y: float,
        color: str = PURPLE,
        static_vals: dict[int, str] | None = None,
    ) -> str:
        """The grouped concat_all that serializes a legacy transaction.

        Field layout matches the lessons exactly: version(0), input count(10),
        per-input group at 1000+i*100 {txid+0, vout+10, script len+20,
        scriptSig+30, sequence+40}, output count(2000), per-output group at
        3000+j*100 {amount+0, spk len+10, spk+20}, locktime(4000).
        """
        nid = self._nid()
        input_bases = [
            SPINE_INPUT_BASE + i * SPINE_STRIDE for i in range(n_inputs)
        ]
        output_bases = [
            SPINE_OUTPUT_BASE + j * SPINE_STRIDE for j in range(n_outputs)
        ]
        structure = {
            "ungrouped": [
                {"index": 0, "label": "VERSION[4]:", "rows": 1},
                {
                    "index": 10,
                    "label": "INPUT_COUNT (VarInt):",
                    "rows": 1,
                    "small": True,
                },
            ],
            "groups": [
                {
                    "title": "INPUTS[]",
                    "baseIndex": SPINE_INPUT_BASE,
                    "expandable": True,
                    "fieldCountToAdd": 5,
                    "minInstances": 1,
                    "maxInstances": max(10, n_inputs),
                    "fields": [
                        {
                            "index": SPINE_IN_TXID,
                            "label": "TXID[32]:",
                            "placeholder": "Prev TX ID",
                            "rows": 2,
                        },
                        {
                            "index": SPINE_IN_VOUT,
                            "label": "VOUT[4]:",
                            "placeholder": "00000000",
                            "rows": 1,
                        },
                        {
                            "index": SPINE_IN_SCRIPT_LEN,
                            "label": "SCRIPT_LENGTH (VarInt):",
                            "rows": 1,
                            "allowEmpty00": True,
                        },
                        {
                            "index": SPINE_IN_SCRIPT_SIG,
                            "label": "SCRIPT_SIG[]:",
                            "placeholder": "<sig> <pk>",
                            "rows": 3,
                            "allowEmptyBlank": True,
                        },
                        {
                            "index": SPINE_IN_SEQUENCE,
                            "label": "SEQUENCE[4]:",
                            "placeholder": "ffffffff",
                            "rows": 1,
                        },
                    ],
                },
                {
                    "title": "OUTPUTS[]",
                    "baseIndex": SPINE_OUTPUT_BASE,
                    "expandable": True,
                    "fieldCountToAdd": 3,
                    "minInstances": 1,
                    "maxInstances": max(10, n_outputs),
                    "fields": [
                        {
                            "index": SPINE_OUT_AMOUNT,
                            "label": "AMOUNT[8]:",
                            "placeholder": "Satoshis (hex)",
                            "rows": 1,
                        },
                        {
                            "index": SPINE_OUT_SPK_LEN,
                            "label": "SCRIPT_PUBKEY_LENGTH:",
                            "rows": 1,
                            "small": True,
                        },
                        {
                            "index": SPINE_OUT_SPK,
                            "label": "SCRIPT_PUBKEY[]:",
                            "placeholder": "Locking script",
                            "rows": 3,
                        },
                    ],
                },
            ],
            "betweenGroups": {
                "INPUTS[]": [
                    {
                        "index": SPINE_OUTPUT_COUNT,
                        "label": "OUTPUT_COUNT (VarInt):",
                        "rows": 1,
                        "small": True,
                    }
                ]
            },
            "afterGroups": [
                {
                    "index": SPINE_LOCKTIME,
                    "label": "LOCKTIME[4]:",
                    "placeholder": "00000000",
                    "rows": 1,
                }
            ],
        }
        total = 2 + 5 * n_inputs + 1 + 3 * n_outputs + 1
        vals = {str(k): v for k, v in (static_vals or {}).items()}
        self.nodes.append(
            {
                "id": nid,
                "type": "calculation",
                "position": {"x": x, "y": y},
                "data": {
                    "functionName": "concat_all",
                    "title": title,
                    "paramExtraction": "multi_val",
                    "numInputs": total,
                    "totalInputs": total,
                    "unwiredCount": 0,
                    "baseHeight": 120,
                    "dirty": False,
                    "version": 0,
                    "inputs": {"vals": vals},
                    "result": "",
                    "inputStructure": structure,
                    "groupInstances": {
                        "INPUTS[]": n_inputs,
                        "OUTPUTS[]": n_outputs,
                    },
                    "groupInstanceKeys": {
                        "INPUTS[]": input_bases,
                        "OUTPUTS[]": output_bases,
                    },
                    "borderColor": color,
                    "error": False,
                },
            }
        )
        return nid

    def extract(
        self,
        title: str,
        fields: list[str],
        x: float,
        y: float,
        color: str = TEAL,
    ) -> str:
        """An extract_tx_field node with one output port per extracted field."""
        nid = self._nid()
        self.nodes.append(
            {
                "id": nid,
                "type": "calculation",
                "position": {"x": x, "y": y},
                "data": {
                    "functionName": "extract_tx_field",
                    "title": title,
                    "paramExtraction": "multi_val",
                    "numInputs": 2,
                    "showField": False,
                    "dirty": False,
                    "version": 0,
                    "txFieldExtractMode": "dynamic",
                    "txExtractFields": list(fields),
                    "outputPorts": [
                        {
                            "label": field,
                            "handleId": f"output-{i}",
                            "showLabel": False,
                        }
                        for i, field in enumerate(fields)
                    ],
                    "inputs": {"vals": {}},
                    "result": "",
                    "inputStructure": {
                        "ungrouped": [
                            {
                                "index": 0,
                                "label": "Raw TX (hex):",
                                "rows": 3,
                                "placeholder": "<transaction hex>",
                            },
                            {
                                "index": 1,
                                "label": "VIN/VOUT Index:",
                                "rows": 1,
                                "placeholder": "0",
                            },
                        ]
                    },
                    "groupInstances": {},
                    "borderColor": color,
                    "error": False,
                },
            }
        )
        return nid

    def text_info(
        self,
        content: str,
        x: float,
        y: float,
        width: int,
        height: int,
        font_size: int = 28,
        title: str = "Text Info Node",
    ) -> str:
        nid = self._nid()
        self.nodes.append(
            {
                "id": nid,
                "type": "shadcnTextInfo",
                "position": {"x": x, "y": y},
                "width": width,
                "height": height,
                "data": {
                    "content": content,
                    "fontSize": font_size,
                    "width": width,
                    "height": height,
                    "title": title,
                    "dirty": False,
                },
            }
        )
        return nid

    # ── edges ────────────────────────────────────────────────────────────────
    def edge(
        self,
        source: str,
        target: str,
        index: int = 0,
        source_handle: str | None = None,
    ) -> str:
        eid = self._eid()
        e = {
            "source": source,
            "target": target,
            "targetHandle": f"input-{index}",
            "selected": False,
            "id": eid,
        }
        if source_handle is not None:
            e["sourceHandle"] = source_handle
        self.edges.append(e)
        return eid

    # ── output ───────────────────────────────────────────────────────────────
    def flow(self, name: str) -> dict:
        return {
            "name": name,
            "schemaVersion": 1,
            "nodes": self.nodes,
            "edges": self.edges,
        }
