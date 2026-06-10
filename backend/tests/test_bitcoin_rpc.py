"""Tests for the Bitcoin Core RPC client and the /bitcoin/* endpoints."""

import json

import pytest
import requests

from backend import bitcoin_rpc
from backend.bitcoin_rpc import (
    BitcoinRPC,
    BitcoinRPCError,
    BitcoinRPCForbidden,
    BitcoinRPCUnavailable,
)


class FakeResponse:
    def __init__(self, body, status_code=200):
        self._body = body
        self.status_code = status_code

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("not json")
        return self._body


def make_client(responses, tmp_path, **kwargs):
    """Client with a fake transport; responses maps method -> body or exception."""
    cookie = tmp_path / ".cookie"
    cookie.write_text("__cookie__:secret")
    calls = []

    def fake_post(url, json=None, auth=None, timeout=None):
        calls.append({"url": url, "payload": json, "auth": auth})
        reply = responses[json["method"]]
        if isinstance(reply, Exception):
            raise reply
        return reply

    client = BitcoinRPC(cookie_file=str(cookie), post=fake_post, **kwargs)
    return client, calls


CHAIN_INFO = {
    "result": {
        "chain": "regtest",
        "blocks": 101,
        "headers": 101,
        "initialblockdownload": False,
        "warnings": [],
    },
    "error": None,
}


# --------------------------------------------------------------------- client


def test_call_uses_cookie_auth_and_returns_result(tmp_path):
    client, calls = make_client(
        {"getblockcount": FakeResponse({"result": 101, "error": None})}, tmp_path
    )
    assert client.call("getblockcount") == 101
    assert calls[0]["auth"] == ("__cookie__", "secret")
    assert calls[0]["payload"]["params"] == []


def test_missing_cookie_raises_unavailable(tmp_path):
    client = BitcoinRPC(cookie_file=str(tmp_path / "missing"), post=lambda *a, **k: None)
    with pytest.raises(BitcoinRPCUnavailable, match="Cookie file not found"):
        client.call("getblockcount")


def test_malformed_cookie_raises_unavailable(tmp_path):
    cookie = tmp_path / ".cookie"
    cookie.write_text("no-colon-here")
    client = BitcoinRPC(cookie_file=str(cookie), post=lambda *a, **k: None)
    with pytest.raises(BitcoinRPCUnavailable, match="malformed"):
        client.call("getblockcount")


def test_explicit_credentials_skip_cookie(tmp_path):
    calls = []

    def fake_post(url, json=None, auth=None, timeout=None):
        calls.append(auth)
        return FakeResponse({"result": 1, "error": None})

    client = BitcoinRPC(user="alice", password="pw", post=fake_post)
    assert client.call("getblockcount") == 1
    assert calls[0] == ("alice", "pw")


def test_connection_error_raises_unavailable(tmp_path):
    client, _ = make_client(
        {"getblockcount": requests.exceptions.ConnectionError("refused")}, tmp_path
    )
    with pytest.raises(BitcoinRPCUnavailable, match="Cannot reach bitcoind"):
        client.call("getblockcount")


def test_http_401_raises_unavailable(tmp_path):
    client, _ = make_client(
        {"getblockcount": FakeResponse({}, status_code=401)}, tmp_path
    )
    with pytest.raises(BitcoinRPCUnavailable, match="401"):
        client.call("getblockcount")


def test_non_json_response_raises_unavailable(tmp_path):
    client, _ = make_client(
        {"getblockcount": FakeResponse("<html>", status_code=500)}, tmp_path
    )
    with pytest.raises(BitcoinRPCUnavailable, match="non-JSON"):
        client.call("getblockcount")


def test_rpc_error_is_forwarded(tmp_path):
    client, _ = make_client(
        {
            "getblockhash": FakeResponse(
                {"result": None, "error": {"code": -8, "message": "Block height out of range"}}
            )
        },
        tmp_path,
    )
    with pytest.raises(BitcoinRPCError) as exc_info:
        client.call("getblockhash", [999999])
    assert exc_info.value.code == -8
    assert "out of range" in exc_info.value.message


def test_non_dict_body_raises_unavailable(tmp_path):
    client, _ = make_client(
        {"getblockcount": FakeResponse([1, 2, 3])}, tmp_path
    )
    with pytest.raises(BitcoinRPCUnavailable, match="response shape"):
        client.call("getblockcount")


def test_string_error_becomes_rpc_error(tmp_path):
    client, _ = make_client(
        {"getblockcount": FakeResponse({"result": None, "error": "boom"})}, tmp_path
    )
    with pytest.raises(BitcoinRPCError) as exc_info:
        client.call("getblockcount")
    assert exc_info.value.code == 0
    assert exc_info.value.message == "boom"


def test_null_error_code_defaults_to_zero(tmp_path):
    client, _ = make_client(
        {
            "getblockcount": FakeResponse(
                {"result": None, "error": {"code": None, "message": "weird"}}
            )
        },
        tmp_path,
    )
    with pytest.raises(BitcoinRPCError) as exc_info:
        client.call("getblockcount")
    assert exc_info.value.code == 0
    assert exc_info.value.message == "weird"


def test_gated_rechecks_chain_each_call(tmp_path):
    """A node restarted from regtest to mainnet must block wallet calls live."""
    cookie = tmp_path / ".cookie"
    cookie.write_text("__cookie__:secret")
    chains = iter(["regtest", "main"])

    def fake_post(url, json=None, auth=None, timeout=None):
        method = json["method"]
        if method == "getblockchaininfo":
            return FakeResponse({"result": {"chain": next(chains)}, "error": None})
        if method == "getnewaddress":
            return FakeResponse({"result": "bcrt1q...", "error": None})
        raise KeyError(method)

    client = BitcoinRPC(cookie_file=str(cookie), post=fake_post)
    assert client.call_gated("getnewaddress") == "bcrt1q..."  # regtest: allowed
    with pytest.raises(BitcoinRPCForbidden, match="read-only"):
        client.call_gated("getnewaddress")  # now mainnet: blocked


def test_invalid_network_rejected():
    with pytest.raises(ValueError, match="Unknown Bitcoin network"):
        BitcoinRPC(network="lightning")


def test_default_url_and_cookie_follow_network(tmp_path):
    client = BitcoinRPC(network="regtest", datadir=str(tmp_path))
    assert client.url.endswith(":18443")
    assert client._cookie_path() == tmp_path / "regtest" / ".cookie"
    mainnet = BitcoinRPC(network="mainnet", datadir=str(tmp_path))
    assert mainnet.url.endswith(":8332")
    assert mainnet._cookie_path() == tmp_path / ".cookie"


# --------------------------------------------------------------------- gating


def test_gated_blocks_invalid_method_names(tmp_path):
    client, _ = make_client({"getblockchaininfo": FakeResponse(CHAIN_INFO)}, tmp_path)
    with pytest.raises(BitcoinRPCForbidden):
        client.call_gated("getblockcount; rm -rf /")


def test_gated_blocks_denylist_even_on_regtest(tmp_path):
    client, _ = make_client({"getblockchaininfo": FakeResponse(CHAIN_INFO)}, tmp_path)
    with pytest.raises(BitcoinRPCForbidden, match="blocked by rawBit"):
        client.call_gated("stop")


def test_gated_allows_wallet_methods_on_regtest(tmp_path):
    client, _ = make_client(
        {
            "getblockchaininfo": FakeResponse(CHAIN_INFO),
            "getnewaddress": FakeResponse({"result": "bcrt1q...", "error": None}),
        },
        tmp_path,
    )
    assert client.call_gated("getnewaddress") == "bcrt1q..."


def test_gated_blocks_wallet_methods_outside_regtest(tmp_path):
    mainnet_info = FakeResponse(
        {"result": {**CHAIN_INFO["result"], "chain": "main"}, "error": None}
    )
    client, _ = make_client(
        {"getblockchaininfo": mainnet_info}, tmp_path, network="mainnet"
    )
    with pytest.raises(BitcoinRPCForbidden, match="read-only"):
        client.call_gated("sendtoaddress", ["addr", 1])
    # read-only methods still pass the gate (chain already cached)
    with pytest.raises(KeyError):  # transport has no canned response = gate passed
        client.call_gated("getblockcount")


def test_status_reports_chain_and_height(tmp_path):
    client, _ = make_client({"getblockchaininfo": FakeResponse(CHAIN_INFO)}, tmp_path)
    status = client.status()
    assert status == {
        "connected": True,
        "chain": "regtest",
        "blocks": 101,
        "headers": 101,
        "initialBlockDownload": False,
        "warnings": [],
    }


def test_enabled_flag_reads_env(monkeypatch):
    monkeypatch.delenv("RAWBIT_BITCOIN_RPC_ENABLED", raising=False)
    assert bitcoin_rpc.bitcoin_rpc_enabled() is False
    monkeypatch.setenv("RAWBIT_BITCOIN_RPC_ENABLED", "1")
    assert bitcoin_rpc.bitcoin_rpc_enabled() is True


# --------------------------------------------------------------------- routes


@pytest.fixture()
def api(monkeypatch):
    import routes

    monkeypatch.setenv("RAWBIT_BITCOIN_RPC_ENABLED", "1")
    return routes


def _client(api):
    api.app.config["TESTING"] = True
    return api.app.test_client()


def test_routes_disabled_returns_404(monkeypatch):
    import routes

    monkeypatch.delenv("RAWBIT_BITCOIN_RPC_ENABLED", raising=False)
    monkeypatch.setattr(routes.app, "debug", False)
    client = _client(routes)
    assert client.get("/bitcoin/status").status_code == 404
    assert client.post("/bitcoin/rpc", json={"method": "getblockcount"}).status_code == 404


def test_guard_rejects_non_loopback_client(api, monkeypatch):
    monkeypatch.setattr(
        api.bitcoin_rpc_client, "status", lambda: {"connected": True}
    )
    response = _client(api).get("/bitcoin/status", environ_overrides={"REMOTE_ADDR": "192.168.1.50"})
    assert response.status_code == 403
    assert "loopback" in response.get_json()["error"]["message"]


def test_guard_rejects_foreign_host_header(api, monkeypatch):
    monkeypatch.setattr(
        api.bitcoin_rpc_client, "status", lambda: {"connected": True}
    )
    response = _client(api).get("/bitcoin/status", headers={"Host": "evil.com"})
    assert response.status_code == 403
    assert "Host" in response.get_json()["error"]["message"]


def test_guard_allows_loopback_host_with_port(api, monkeypatch):
    monkeypatch.setattr(
        api.bitcoin_rpc_client, "status", lambda: {"connected": True, "chain": "regtest"}
    )
    response = _client(api).get("/bitcoin/status", headers={"Host": "localhost:5007"})
    assert response.status_code == 200


def test_status_route_connected(api, monkeypatch):
    monkeypatch.setattr(
        api.bitcoin_rpc_client, "status", lambda: {"connected": True, "chain": "regtest"}
    )
    response = _client(api).get("/bitcoin/status")
    assert response.status_code == 200
    assert response.get_json() == {"connected": True, "chain": "regtest"}


def test_status_route_unavailable(api, monkeypatch):
    def boom():
        raise api.BitcoinRPCUnavailable("node down")

    monkeypatch.setattr(api.bitcoin_rpc_client, "status", boom)
    response = _client(api).get("/bitcoin/status")
    assert response.status_code == 200
    assert response.get_json() == {"connected": False, "error": "node down"}


def test_rpc_route_happy_path(api, monkeypatch):
    monkeypatch.setattr(
        api.bitcoin_rpc_client, "call_gated", lambda method, params: {"chain": "regtest"}
    )
    response = _client(api).post(
        "/bitcoin/rpc", json={"method": "getblockchaininfo", "params": []}
    )
    assert response.status_code == 200
    assert response.get_json() == {"result": {"chain": "regtest"}}


def test_rpc_route_validates_payload(api):
    client = _client(api)
    assert client.post("/bitcoin/rpc", json={}).status_code == 400
    assert client.post("/bitcoin/rpc", json={"method": "  "}).status_code == 400
    assert (
        client.post("/bitcoin/rpc", json={"method": "x", "params": "oops"}).status_code
        == 400
    )


def test_rpc_route_maps_exceptions(api, monkeypatch):
    def forbidden(method, params):
        raise api.BitcoinRPCForbidden("blocked")

    monkeypatch.setattr(api.bitcoin_rpc_client, "call_gated", forbidden)
    response = _client(api).post("/bitcoin/rpc", json={"method": "stop"})
    assert response.status_code == 403

    def rpc_error(method, params):
        raise api.BitcoinRPCError(-32601, "Method not found")

    monkeypatch.setattr(api.bitcoin_rpc_client, "call_gated", rpc_error)
    response = _client(api).post("/bitcoin/rpc", json={"method": "nope"})
    assert response.status_code == 200
    assert response.get_json() == {
        "error": {"code": -32601, "message": "Method not found"}
    }

    def unavailable(method, params):
        raise api.BitcoinRPCUnavailable("node down")

    monkeypatch.setattr(api.bitcoin_rpc_client, "call_gated", unavailable)
    response = _client(api).post("/bitcoin/rpc", json={"method": "getblockcount"})
    assert response.status_code == 503
