"""Rebuild real Bitcoin transactions as rawBit canvas flows.

Public entry points:
  build_rebuild_dataset(rpc, tx_ref) -> dataset   (RPC orchestration + key derivation)
  assemble_dataset(tx_hex, prev_txs) -> dataset   (offline dataset assembly)
  generate_legacy_flow(dataset)      -> FlowData  (general N-in/N-out legacy builder)
"""

from .dataset import assemble_dataset, DatasetError
from .legacy_builder import generate_legacy_flow, UnsupportedTransaction
from .rebuild import build_rebuild_dataset, RebuildError

__all__ = [
    "assemble_dataset",
    "build_rebuild_dataset",
    "generate_legacy_flow",
    "DatasetError",
    "RebuildError",
    "UnsupportedTransaction",
]
