"""JSON-RPC client for a locally installed Bitcoin Core node.

Regtest-first: defaults target a regtest node on 127.0.0.1:18443 using cookie
authentication. The cookie file is re-read on every request because bitcoind
rewrites it on each restart.

Environment variables:
  RAWBIT_BITCOIN_RPC_ENABLED   expose /bitcoin/* endpoints outside Flask debug
  RAWBIT_BITCOIN_NETWORK       regtest (default) | mainnet | testnet | signet
  RAWBIT_BITCOIN_RPC_URL       full RPC URL override (e.g. http://127.0.0.1:18443)
  RAWBIT_BITCOIN_DATADIR       Bitcoin Core data directory (default: platform-specific)
  RAWBIT_BITCOIN_COOKIE_FILE   explicit cookie file path override
  RAWBIT_BITCOIN_RPC_USER      static rpcauth credentials (alternative to cookie)
  RAWBIT_BITCOIN_RPC_PASSWORD
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import requests


def default_datadir() -> Path:
    """Bitcoin Core's default data directory for the current platform."""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Bitcoin"
    if sys.platform.startswith("win"):
        appdata = os.getenv("APPDATA")
        return (Path(appdata) if appdata else home) / "Bitcoin"
    return home / ".bitcoin"

# port and cookie subdirectory per network
NETWORKS = {
    "mainnet": (8332, ""),
    "testnet": (18332, "testnet3"),
    "signet": (38332, "signet"),
    "regtest": (18443, "regtest"),
}

DEFAULT_NETWORK = "regtest"
DEFAULT_TIMEOUT_SECONDS = 15.0

_METHOD_PATTERN = re.compile(r"^[a-z0-9_]{1,64}$")

# Never forwarded, regardless of network.
DENYLIST = {"stop"}

# The only methods forwarded when the node is NOT on regtest.
READONLY_METHODS = {
    "decoderawtransaction",
    "decodescript",
    "estimatesmartfee",
    "getbestblockhash",
    "getblock",
    "getblockchaininfo",
    "getblockcount",
    "getblockhash",
    "getblockheader",
    "getchaintips",
    "getdifficulty",
    "getmempoolentry",
    "getmempoolinfo",
    "getmininginfo",
    "getnetworkinfo",
    "getrawmempool",
    "getrawtransaction",
    "gettxout",
    "help",
    "uptime",
    "validateaddress",
}


def bitcoin_rpc_enabled() -> bool:
    """Whether the /bitcoin/* endpoints may be served outside Flask debug."""
    raw = os.getenv("RAWBIT_BITCOIN_RPC_ENABLED", "")
    return raw.strip().lower() in {"1", "true", "yes"}


class BitcoinRPCUnavailable(Exception):
    """Node unreachable or authentication impossible; message is user-facing."""


class BitcoinRPCForbidden(Exception):
    """Method blocked by rawBit policy; message is user-facing."""


class BitcoinRPCError(Exception):
    """Error returned by bitcoind itself (normal console output)."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class BitcoinRPC:
    def __init__(
        self,
        *,
        url: str | None = None,
        network: str | None = None,
        datadir: str | None = None,
        cookie_file: str | None = None,
        user: str | None = None,
        password: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        post=None,
    ):
        self.network = (network or os.getenv("RAWBIT_BITCOIN_NETWORK") or DEFAULT_NETWORK).lower()
        if self.network not in NETWORKS:
            raise ValueError(f"Unknown Bitcoin network '{self.network}'")
        port, _ = NETWORKS[self.network]
        self.url = url or os.getenv("RAWBIT_BITCOIN_RPC_URL") or f"http://127.0.0.1:{port}"
        self.datadir = Path(datadir or os.getenv("RAWBIT_BITCOIN_DATADIR") or default_datadir())
        self.cookie_file = cookie_file or os.getenv("RAWBIT_BITCOIN_COOKIE_FILE")
        self.user = user or os.getenv("RAWBIT_BITCOIN_RPC_USER")
        self.password = password or os.getenv("RAWBIT_BITCOIN_RPC_PASSWORD")
        self.timeout = timeout
        self._post = post or requests.post
        self._chain: str | None = None

    # ------------------------------------------------------------------ auth

    def _cookie_path(self) -> Path:
        if self.cookie_file:
            return Path(self.cookie_file)
        _, subdir = NETWORKS[self.network]
        return (self.datadir / subdir if subdir else self.datadir) / ".cookie"

    def _resolve_auth(self) -> tuple[str, str]:
        if self.user and self.password:
            return (self.user, self.password)
        path = self._cookie_path()
        try:
            raw = path.read_text().strip()
        except OSError:
            raise BitcoinRPCUnavailable(
                f"Cookie file not found at {path}. Is bitcoind running on {self.network}? "
                "(Start it, or set RAWBIT_BITCOIN_COOKIE_FILE / RPC user+password.)"
            )
        if ":" not in raw:
            raise BitcoinRPCUnavailable(f"Cookie file at {path} is malformed.")
        user, password = raw.split(":", 1)
        return (user, password)

    # ------------------------------------------------------------------ calls

    def call(self, method: str, params: list | dict | None = None):
        payload = {
            "jsonrpc": "2.0",
            "id": "rawbit",
            "method": method,
            "params": params if params is not None else [],
        }
        try:
            response = self._post(
                self.url,
                json=payload,
                auth=self._resolve_auth(),
                timeout=self.timeout,
            )
        except requests.exceptions.RequestException as exc:
            raise BitcoinRPCUnavailable(
                f"Cannot reach bitcoind at {self.url} — is it running? ({exc.__class__.__name__})"
            )
        if response.status_code == 401:
            raise BitcoinRPCUnavailable(
                "bitcoind rejected the RPC credentials (401). The cookie may be stale — "
                "was the node restarted?"
            )
        try:
            body = response.json()
        except ValueError:
            raise BitcoinRPCUnavailable(
                f"Unexpected non-JSON response from {self.url} (HTTP {response.status_code})."
            )
        if not isinstance(body, dict):
            raise BitcoinRPCUnavailable(
                f"Unexpected JSON-RPC response shape from {self.url} "
                f"(HTTP {response.status_code}) — is this really bitcoind?"
            )
        error = body.get("error")
        if error:
            if not isinstance(error, dict):
                raise BitcoinRPCError(0, str(error))
            code = error.get("code")
            raise BitcoinRPCError(
                int(code) if isinstance(code, int) else 0,
                str(error.get("message") or "unknown RPC error"),
            )
        return body.get("result")

    def chain(self) -> str:
        if self._chain is None:
            info = self.call("getblockchaininfo")
            self._chain = str(info.get("chain", "unknown"))
        return self._chain

    def call_gated(self, method: str, params: list | dict | None = None):
        """Forward a console command, enforcing the rawBit safety policy.

        Read-only methods are allowed on any chain. State-changing methods are
        only forwarded on regtest, and the chain is re-checked live for each
        such call rather than trusting a cached value — a node restarted on a
        different chain must never receive a wallet command meant for regtest.
        """
        normalized = (method or "").strip().lower()
        if not _METHOD_PATTERN.match(normalized):
            raise BitcoinRPCForbidden(f"'{method}' is not a valid RPC method name.")
        if normalized in DENYLIST:
            raise BitcoinRPCForbidden(f"'{normalized}' is blocked by rawBit.")
        if normalized not in READONLY_METHODS:
            info = self.call("getblockchaininfo")
            self._chain = str(info.get("chain", "unknown"))
            if self._chain != "regtest":
                raise BitcoinRPCForbidden(
                    f"'{normalized}' is blocked: the node is on '{self._chain}' and rawBit "
                    "only forwards read-only commands outside regtest."
                )
        return self.call(normalized, params)

    def status(self) -> dict:
        info = self.call("getblockchaininfo")
        self._chain = str(info.get("chain", "unknown"))
        return {
            "connected": True,
            "chain": self._chain,
            "blocks": info.get("blocks"),
            "headers": info.get("headers"),
            "initialBlockDownload": info.get("initialblockdownload"),
            "warnings": info.get("warnings") or [],
        }
