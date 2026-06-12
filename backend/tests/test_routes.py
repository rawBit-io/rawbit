import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from ipaddress import ip_network

import pytest
from werkzeug.exceptions import BadRequest

pytest.importorskip("bitcointx")
pytest.importorskip("secp256k1")

from backend import graph_logic, routes
from backend import computation_budget as budget_module
from backend.computation_budget import InMemoryCalculationBudgetTracker
from config import (
    APP_VERSION,
    CALCULATION_TIME_BUDGET_SECONDS,
    CALCULATION_TIME_WINDOW_SECONDS,
    CALCULATION_TIMEOUT_SECONDS,
)


@pytest.fixture()
def client():
    routes.app.config["TESTING"] = True
    routes.computation_budget.reset()
    with routes.app.test_client() as client:
        yield client


def test_healthz_endpoint(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.get_json() == {
        "ok": True,
        "version": APP_VERSION,
        "limits": {
            "maxPayloadBytes": routes.app.config["MAX_CONTENT_LENGTH"],
            "calculationTimeoutSeconds": CALCULATION_TIMEOUT_SECONDS,
            "calculationTimeBudgetSeconds": CALCULATION_TIME_BUDGET_SECONDS,
            "calculationTimeWindowSeconds": CALCULATION_TIME_WINDOW_SECONDS,
        },
    }


def test_flows_catalog(client):
    resp = client.get("/flows")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "flows" in data
    assert isinstance(data["flows"], list)
    assert any(flow["slug"] == "p9_SegWit_P2WSH" for flow in data["flows"])
    assert resp.headers["Cache-Control"] == "public, max-age=3600"


def test_get_single_flow(client):
    resp = client.get("/flows/p9_SegWit_P2WSH")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert isinstance(payload, dict)
    assert payload.get("schemaVersion") is not None
    assert any(node.get("data", {}).get("functionName") == "hash160_hex" for node in payload.get("nodes", []))
    assert resp.headers["Cache-Control"] == "public, max-age=86400"


def test_get_flow_404_for_unknown_slug(client):
    resp = client.get("/flows/not_real")
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "flow_not_found"


def test_flow_routes_are_rate_limited(client):
    routes.limiter.reset()
    # No @limiter.exempt: the default limit must apply (headers enabled).
    resp = client.get("/flows")
    assert "X-RateLimit-Limit" in resp.headers
    resp = client.get("/flows/p9_SegWit_P2WSH")
    assert "X-RateLimit-Limit" in resp.headers


def test_bulk_calculate_rejects_invalid_body(client):
    resp = client.post("/bulk_calculate", data="not json", content_type="application/json")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Invalid JSON body"


def test_bulk_calculate_requires_array_payloads(client):
    resp = client.post("/bulk_calculate", json={"nodes": [], "edges": "bad"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "nodes and edges must be arrays"


def test_bulk_calculate_rejects_malformed_elements(client):
    for nodes in ([1], ["x"], [{}], [{"id": 7}]):
        resp = client.post("/bulk_calculate", json={"nodes": nodes, "edges": []})
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "each node must be an object with a string 'id'"

    resp = client.post("/bulk_calculate", json={"nodes": [], "edges": ["x"]})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "each edge must be an object"


def test_bulk_calculate_success(monkeypatch, client):
    captured = {}

    def fake_logic(nodes, edges):
        captured["payload"] = (nodes, edges)
        return ([{"id": "n1", "data": {"result": "ok"}}], [])

    monkeypatch.setattr(routes, "bulk_calculate_logic", fake_logic)

    payload = {"nodes": [{"id": "a"}], "edges": [], "version": 2}
    resp = client.post("/bulk_calculate", json=payload)

    assert captured["payload"] == ([{"id": "a"}], [])
    assert resp.status_code == 200
    assert resp.get_json() == {"nodes": [{"id": "n1", "data": {"result": "ok"}}], "version": 2}


def test_bulk_calculate_returns_errors(monkeypatch, client):
    def fake_logic(nodes, edges):
        return ([{"id": "n1"}], [{"nodeId": "n1", "error": "boom"}])

    monkeypatch.setattr(routes, "bulk_calculate_logic", fake_logic)

    resp = client.post("/bulk_calculate", json={"nodes": [], "edges": [], "version": 3})

    assert resp.status_code == 400
    assert resp.get_json() == {
        "nodes": [{"id": "n1"}],
        "version": 3,
        "errors": [{"nodeId": "n1", "error": "boom"}],
    }


def test_bulk_calculate_executes_real_logic(client):
    routes.limiter.reset()

    payload = {
        "nodes": [
            {
                "id": "src",
                "data": {
                    "functionName": "identity",
                    "value": "abc",
                    "dirty": True,
                },
            },
            {
                "id": "dst",
                "data": {
                    "functionName": "concat_all",
                    "dirty": True,
                    "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
                    "inputs": {"vals": {"1": "manual"}},
                },
            },
        ],
        "edges": [{"source": "src", "target": "dst", "targetHandle": "dst-0"}],
        "version": 7,
    }

    resp = client.post("/bulk_calculate", json=payload)

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["version"] == 7
    results = {node["id"]: node for node in data["nodes"]}
    assert results["src"]["data"]["result"] == "abc"
    assert results["src"]["data"].get("dirty") is False
    assert results["dst"]["data"]["result"] == "abcmanual"
    assert results["dst"]["data"].get("dirty") is False


def test_bulk_calculate_handles_concurrent_requests(monkeypatch):
    routes.limiter.reset()
    routes.computation_budget.reset()
    seen = []
    guard = threading.Lock()

    def fake_logic(nodes, edges):
        time.sleep(0.01)
        node_id = nodes[0]["id"]
        with guard:
            seen.append(node_id)
        return ([{"id": node_id, "data": {"result": node_id}}], [])

    monkeypatch.setattr(routes, "bulk_calculate_logic", fake_logic)

    payloads = [
        {"nodes": [{"id": f"n{i}", "data": {}}], "edges": [], "version": i}
        for i in range(8)
    ]

    def fire(payload):
        with routes.app.test_client() as local_client:
            resp = local_client.post("/bulk_calculate", json=payload)
            return resp.status_code, resp.get_json()

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = [future.result() for future in (pool.submit(fire, payload) for payload in payloads)]

    assert all(status == 200 for status, _ in results)
    assert sorted(seen) == sorted(f"n{i}" for i in range(8))
    for (_, payload), expected_id in zip(results, [f"n{i}" for i in range(8)]):
        assert payload["nodes"][0]["data"]["result"] == expected_id


def test_bulk_calculate_enforces_calculation_budget(monkeypatch, client):
    tracker = InMemoryCalculationBudgetTracker(window_seconds=5.0, budget_seconds=0.05)
    monkeypatch.setattr(routes, "computation_budget", tracker)

    counter = {"calls": -1}

    def fake_perf_counter():
        counter["calls"] += 1
        return counter["calls"] * 0.03

    wall_clock = {"tick": -1}

    def fake_time():
        wall_clock["tick"] += 1
        return float(wall_clock["tick"])

    monkeypatch.setattr(routes.time, "perf_counter", fake_perf_counter)
    monkeypatch.setattr(routes.time, "time", fake_time)
    monkeypatch.setattr(budget_module.time, "time", fake_time)

    def cheap_logic(nodes, edges):
        return ([{"id": nodes[0]["id"], "data": {"result": "ok"}}], [])

    monkeypatch.setattr(routes, "bulk_calculate_logic", cheap_logic)

    payload = {"nodes": [{"id": "n1", "data": {}}], "edges": [], "version": 1}

    resp1 = client.post("/bulk_calculate", json=payload)
    resp2 = client.post("/bulk_calculate", json=payload)
    resp3 = client.post("/bulk_calculate", json=payload)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp3.status_code == 429

    data = resp3.get_json()
    assert data["error"] == "calculation_time_limited"
    assert data["observedSeconds"] >= 0.06
    assert "Calculation requests are limited" in data["detail"]
    assert data["version"] == 1
    assert data["errors"]
    assert any("Calculation requests are limited" in entry["error"] for entry in data["errors"])

    returned_nodes = data.get("nodes")
    assert returned_nodes
    first_node = returned_nodes[0]
    assert first_node["id"] == "n1"
    node_data = first_node["data"]
    assert node_data["error"] is True
    assert node_data["dirty"] is False
    assert "Calculation requests are limited" in node_data["extendedError"]


def test_get_code_requires_function_name(client):
    resp = client.get("/code")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Function name not provided"


def test_get_code_404_when_missing(monkeypatch, client):
    monkeypatch.setattr(routes, "GLOBAL_CALC_FUNCTIONS", {})
    resp = client.get("/code", query_string={"functionName": "not_there"})
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "Function not found"


def test_get_code_success(monkeypatch, client):
    def sample_function():
        return "hi"

    monkeypatch.setattr(routes, "GLOBAL_CALC_FUNCTIONS", {"sample": sample_function})

    def fake_expand(func, source):
        assert func is sample_function
        assert "def sample_function" in source
        return "expanded"

    monkeypatch.setattr(routes, "expand_function_source", fake_expand)

    resp = client.get("/code", query_string={"functionName": "sample"})

    assert resp.status_code == 200
    assert resp.get_json() == {"code": "expanded"}
    assert resp.headers["Cache-Control"] == "public, max-age=900"


def test_get_code_handles_missing_source(monkeypatch, client):
    def sample_function():
        return "hi"

    monkeypatch.setattr(routes, "GLOBAL_CALC_FUNCTIONS", {"sample": sample_function})

    def raise_oserror(_func):
        raise OSError("no source")

    monkeypatch.setattr(routes.inspect, "getsource", raise_oserror)

    resp = client.get("/code", query_string={"functionName": "sample"})

    assert resp.status_code == 200
    assert resp.get_json() == {"code": "Source not available"}


def test_get_client_ip_trusts_cloudflare_header_from_trusted_proxy(monkeypatch):
    monkeypatch.setattr(routes, "TRUSTED_PROXY_NETWORKS", (ip_network("9.9.9.0/24"),))
    with routes.app.test_request_context(
        "/",
        headers={"CF-Connecting-IP": "1.2.3.4", "CF-RAY": "abc"},
        environ_base={"REMOTE_ADDR": "9.9.9.9"},
    ):
        assert routes.get_client_ip() == "1.2.3.4"


def test_get_client_ip_ignores_cloudflare_header_from_untrusted_peer(monkeypatch):
    monkeypatch.setattr(routes, "TRUSTED_PROXY_NETWORKS", ())
    with routes.app.test_request_context(
        "/",
        headers={"CF-Connecting-IP": "1.2.3.4", "CF-RAY": "abc"},
        environ_base={"REMOTE_ADDR": "9.9.9.9"},
    ):
        assert routes.get_client_ip() == "9.9.9.9"


def test_get_client_ip_ignores_invalid_cloudflare_ip_from_trusted_proxy(monkeypatch):
    monkeypatch.setattr(routes, "TRUSTED_PROXY_NETWORKS", (ip_network("9.9.9.0/24"),))
    with routes.app.test_request_context(
        "/",
        headers={"CF-Connecting-IP": "not-an-ip", "CF-RAY": "abc"},
        environ_base={"REMOTE_ADDR": "9.9.9.9"},
    ):
        assert routes.get_client_ip() == "9.9.9.9"


def test_get_client_ip_falls_back_to_remote_addr(monkeypatch):
    monkeypatch.setattr(routes, "TRUSTED_PROXY_NETWORKS", (ip_network("9.9.9.0/24"),))
    with routes.app.test_request_context(
        "/",
        headers={"CF-Connecting-IP": "1.2.3.4"},
        environ_base={"REMOTE_ADDR": "5.6.7.8"},
    ):
        assert routes.get_client_ip() == "5.6.7.8"


def test_bulk_calculate_handles_unexpected_error(monkeypatch, client):
    def explode(_nodes, _edges):
        raise RuntimeError("boom")

    monkeypatch.setattr(routes, "bulk_calculate_logic", explode)

    resp = client.post("/bulk_calculate", json={"nodes": [], "edges": []})

    assert resp.status_code == 500
    assert resp.get_json() == {"error": "internal_server_error"}


def test_bulk_calculate_preserves_http_exceptions(monkeypatch, client):
    routes.limiter.reset()

    def explode(_nodes, _edges):
        raise BadRequest("nope")

    monkeypatch.setattr(routes, "bulk_calculate_logic", explode)

    resp = client.post("/bulk_calculate", json={"nodes": [], "edges": []})

    assert resp.status_code == 400
    assert "nope" in resp.get_data(as_text=True)


def test_bulk_calculate_payload_too_large_returns_413(monkeypatch, client):
    monkeypatch.setitem(routes.app.config, "MAX_CONTENT_LENGTH", 64)
    resp = client.post(
        "/bulk_calculate",
        data="x" * 128,
        content_type="application/json",
    )
    assert resp.status_code == 413
    assert resp.get_json() == {"error": "payload_too_large", "limit_bytes": 64}


def test_bulk_calculate_accepts_payload_at_size_limit(monkeypatch):
    routes.limiter.reset()

    def passthrough(nodes, edges):
        return (nodes, [])

    monkeypatch.setattr(routes, "bulk_calculate_logic", passthrough)

    max_bytes = routes.app.config["MAX_CONTENT_LENGTH"]
    payload = {
        "nodes": [{"id": "limit", "data": {"value": ""}}],
        "edges": [],
        "version": 1,
    }

    filler_len = 1
    body = b""
    while True:
        payload["nodes"][0]["data"]["value"] = "x" * max(filler_len, 0)
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        diff = max_bytes - len(body)
        if diff == 0:
            break
        filler_len += diff
        if filler_len <= 0:
            pytest.fail("Unable to craft payload at limit")

    assert len(body) == max_bytes

    with routes.app.test_client() as heavy_client:
        resp = heavy_client.post(
            "/bulk_calculate",
            data=body,
            content_type="application/json",
        )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["nodes"][0]["id"] == "limit"


def test_bulk_calculate_rate_limit_returns_429(monkeypatch, client):
    routes.limiter.reset()
    monkeypatch.setattr(routes, "bulk_calculate_logic", lambda nodes, edges: ([], []))
    payload = {"nodes": [], "edges": []}

    for _ in range(60):
        resp = client.post("/bulk_calculate", json=payload)
        assert resp.status_code == 200

    resp = client.post("/bulk_calculate", json=payload)
    assert resp.status_code == 429
    data = resp.get_json()
    assert data["error"] == "rate_limited"
    assert "detail" in data


def test_code_rate_limit_returns_429(monkeypatch, client):
    routes.limiter.reset()

    def sample():
        return "hi"

    monkeypatch.setattr(routes, "GLOBAL_CALC_FUNCTIONS", {"sample": sample})
    monkeypatch.setattr(routes, "expand_function_source", lambda func, source: source)
    monkeypatch.setattr(routes.inspect, "getsource", lambda func: "def sample():\n    return 'hi'\n")

    for _ in range(30):
        resp = client.get("/code", query_string={"functionName": "sample"})
        assert resp.status_code == 200

    resp = client.get("/code", query_string={"functionName": "sample"})
    assert resp.status_code == 429
    data = resp.get_json()
    assert data["error"] == "rate_limited"


def test_code_rate_limit_ignores_rotating_spoofed_cloudflare_ips(monkeypatch, client):
    routes.limiter.reset()
    monkeypatch.setattr(routes, "TRUSTED_PROXY_NETWORKS", ())

    def sample():
        return "hi"

    monkeypatch.setattr(routes, "GLOBAL_CALC_FUNCTIONS", {"sample": sample})
    monkeypatch.setattr(routes, "expand_function_source", lambda func, source: source)
    monkeypatch.setattr(routes.inspect, "getsource", lambda func: "def sample():\n    return 'hi'\n")

    for index in range(30):
        resp = client.get(
            "/code",
            query_string={"functionName": "sample"},
            headers={
                "CF-Connecting-IP": f"198.51.100.{index + 1}",
                "CF-RAY": "fake-ray",
            },
            environ_base={"REMOTE_ADDR": "9.9.9.9"},
        )
        assert resp.status_code == 200

    resp = client.get(
        "/code",
        query_string={"functionName": "sample"},
        headers={"CF-Connecting-IP": "198.51.100.31", "CF-RAY": "fake-ray"},
        environ_base={"REMOTE_ADDR": "9.9.9.9"},
    )
    assert resp.status_code == 429
    assert resp.get_json()["error"] == "rate_limited"


def test_bulk_calculate_surfaces_node_errors(client):
    routes.limiter.reset()

    payload = {
        "nodes": [
            {
                "id": "a",
                "data": {
                    "functionName": "identity",
                    "value": "first",
                    "dirty": True,
                },
            },
            {
                "id": "b",
                "data": {
                    "functionName": "identity",
                    "value": "second",
                    "dirty": True,
                },
            },
            {
                "id": "dst",
                "data": {
                    "functionName": "identity",
                    "dirty": True,
                },
            },
        ],
        "edges": [
            {"source": "a", "target": "dst", "targetHandle": "dst-0"},
            {"source": "b", "target": "dst", "targetHandle": "dst-0"},
        ],
        "version": 1,
    }

    resp = client.post("/bulk_calculate", json=payload)

    assert resp.status_code == 400
    data = resp.get_json()
    assert data["version"] == 1
    assert data["errors"] == [
        {"nodeId": "dst", "error": "Multiple inputs connected to single-value node"}
    ]
    dst = next(node for node in data["nodes"] if node["id"] == "dst")
    assert dst["data"]["error"] is True
    assert "Multiple inputs connected" in dst["data"]["extendedError"]

def test_healthz_allows_cors_origin(client):
    resp = client.get("/healthz", headers={"Origin": "https://rawbit.io"})
    assert resp.status_code == 200
    assert resp.headers.get("Access-Control-Allow-Origin") == "https://rawbit.io"


def test_bulk_calculate_allows_cors_origin(monkeypatch, client):
    routes.limiter.reset()

    monkeypatch.setattr(routes, "bulk_calculate_logic", lambda nodes, edges: ([], []))

    resp = client.post(
        "/bulk_calculate",
        json={"nodes": [], "edges": []},
        headers={"Origin": "https://rawbit.io"},
    )

    assert resp.status_code == 200
    assert resp.headers.get("Access-Control-Allow-Origin") == "https://rawbit.io"


def test_code_allows_cors_origin(monkeypatch, client):
    def sample_function():
        return "hi"

    monkeypatch.setattr(routes, "GLOBAL_CALC_FUNCTIONS", {"sample": sample_function})
    monkeypatch.setattr(routes, "expand_function_source", lambda func, source: source)

    resp = client.get(
        "/code",
        query_string={"functionName": "sample"},
        headers={"Origin": "https://rawbit.io"},
    )

    assert resp.status_code == 200
    assert resp.headers.get("Access-Control-Allow-Origin") == "https://rawbit.io"


def test_cors_blocks_unlisted_origin(client):
    resp = client.get("/healthz", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert resp.headers.get("Access-Control-Allow-Origin") is None
