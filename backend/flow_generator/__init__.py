"""Rebuild real Bitcoin transactions as rawBit canvas flows.

Public entry points:
  build_rebuild_dataset(rpc, tx_hex) -> dataset   (RPC orchestration + key derivation)
  generate_flow(dataset)            -> FlowData   (stamp the lesson template)
"""

from .generator import generate_flow, UnsupportedTransaction
from .rebuild import build_rebuild_dataset, RebuildError

__all__ = [
    "generate_flow",
    "build_rebuild_dataset",
    "UnsupportedTransaction",
    "RebuildError",
]
