"""
rawbit API Backend - Security & Rate Limiting Setup

SECURITY:
- CORS: Restricted to rawbit.io domains + localhost (blocks other websites from using the API)
- Rate Limiting: Two-tier approach
  * Primary: Cloudflare (15 requests/10s on /bulk_calculate)
  * Backup: Flask-Limiter (60/min for /bulk_calculate, 30/min for /code, 200/min default)
- Payload: 5MB max request size
- IP Detection: Trusts CF-Connecting-IP only from configured proxy CIDRs
- Calculation budget: 10s CPU per IP per 60s (shared via Redis when available)

RUNNING:
Development:
  python routes.py

Production (uses all 4 CPU cores):
  gunicorn -c gunicorn_config.py routes:app

The rate limiting is per-worker in memory, so actual limits are ~4x the configured values
when running with Gunicorn. This is acceptable since Cloudflare provides primary protection.
"""


import inspect
import os
import re
import threading
import time
from ipaddress import IPv4Network, IPv6Network, ip_address, ip_network
from pathlib import Path

import orjson
from flask import Flask, Response, request
from flask_cors import CORS
from flask_compress import Compress
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException

from computation_budget import CalculationBudgetTracker, build_budget_tracker
from config import (
    APP_VERSION,
    CALCULATION_TIME_BUDGET_SECONDS,
    CALCULATION_TIME_WINDOW_SECONDS,
    public_limits,
    redis_url,
    trusted_proxy_cidrs,
)
from graph_logic import bulk_calculate_logic, CALC_FUNCTIONS as GLOBAL_CALC_FUNCTIONS
from codeview_expander import expand_function_source
from bitcoin_rpc import (
    BitcoinRPC,
    BitcoinRPCError,
    BitcoinRPCForbidden,
    BitcoinRPCUnavailable,
    bitcoin_rpc_enabled,
)
from flow_generator import (
    build_rebuild_dataset,
    generate_legacy_flow,
    RebuildError,
    UnsupportedTransaction,
)

ROOT_DIR = Path(__file__).resolve().parents[1]
FLOWS_DIR = ROOT_DIR / "src" / "my_tx_flows"

_FLOW_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _build_flow_catalog():
    catalog = []
    if not FLOWS_DIR.exists():
        return catalog

    for path in sorted(FLOWS_DIR.glob("*.json")):
        slug = path.stem
        # Derive a lightweight human label (drop leading chapter prefix if present).
        label_candidate = slug
        if "_" in slug:
            _, remainder = slug.split("_", 1)
            label_candidate = remainder
        label = label_candidate.replace("_", " ")
        catalog.append(
            {
                "slug": slug,
                "label": label,
                "relativePath": f"src/my_tx_flows/{path.name}",
                "apiPath": f"/flows/{slug}",
            }
        )

    return catalog


FLOW_CATALOG = _build_flow_catalog()


app = Flask(__name__)

DEFAULT_ALLOWED_ORIGINS = [
    "https://rawbit.io",
    "https://www.rawbit.io",
    "http://localhost:3041",
    "http://127.0.0.1:3041",
]

_env_origins = os.getenv("CORS_ORIGINS")
if _env_origins:
    allowed_origins = [origin.strip() for origin in _env_origins.split(",") if origin.strip()]
else:
    allowed_origins = DEFAULT_ALLOWED_ORIGINS

CORS(app, resources={r"/*": {"origins": allowed_origins}})

Compress(app)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB
app.config["RATELIMIT_HEADERS_ENABLED"] = True


TrustedProxyNetwork = IPv4Network | IPv6Network


def _parse_trusted_proxy_networks(cidrs: tuple[str, ...]) -> tuple[TrustedProxyNetwork, ...]:
    networks: list[TrustedProxyNetwork] = []
    for cidr in cidrs:
        try:
            networks.append(ip_network(cidr, strict=False))
        except ValueError as exc:
            raise ValueError(
                f"RAWBIT_TRUSTED_PROXY_CIDRS contains invalid CIDR {cidr!r}"
            ) from exc
    return tuple(networks)


TRUSTED_PROXY_NETWORKS = _parse_trusted_proxy_networks(trusted_proxy_cidrs())


def _is_trusted_proxy(remote_addr: str | None) -> bool:
    if not remote_addr:
        return False
    try:
        remote_ip = ip_address(remote_addr.strip())
    except ValueError:
        return False

    return any(
        remote_ip.version == network.version and remote_ip in network
        for network in TRUSTED_PROXY_NETWORKS
    )


def get_client_ip() -> str:
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip and _is_trusted_proxy(request.remote_addr):
        try:
            return str(ip_address(cf_ip.strip()))
        except ValueError:
            pass
    return get_remote_address()

limiter = Limiter(
    key_func=get_client_ip,
    default_limits=["200/minute"],
    storage_uri="memory://",
)
limiter.init_app(app)

computation_budget: CalculationBudgetTracker = build_budget_tracker(
    window_seconds=CALCULATION_TIME_WINDOW_SECONDS,
    budget_seconds=CALCULATION_TIME_BUDGET_SECONDS,
    redis_url=redis_url(),
    logger=app.logger,
)

_budget_time_base: float | None = None
_budget_perf_base: float | None = None
_budget_base_lock = threading.Lock()


def _budget_now() -> float:
    """Return a monotonic wall-clock approximation for budget accounting."""

    global _budget_time_base, _budget_perf_base

    base = _budget_time_base
    perf_base = _budget_perf_base

    if base is None or perf_base is None:
        with _budget_base_lock:
            if _budget_time_base is None or _budget_perf_base is None:
                _budget_time_base = time.time()
                _budget_perf_base = time.perf_counter()
        base = _budget_time_base
        perf_base = _budget_perf_base

    # Defensive fallback: these can only remain None during interpreter shutdown.
    if base is None or perf_base is None:
        return time.time()

    return base + (time.perf_counter() - perf_base)

def _json(data, status=200):
    return Response(orjson.dumps(data), status=status, mimetype="application/json")


def _calculation_budget_error(
    observed: float,
    *,
    version: int,
    request_nodes,
) -> Response:
    detail = (
        "Calculation requests are limited to "
        f"{CALCULATION_TIME_BUDGET_SECONDS:.1f} seconds of server-side work per "
        f"{CALCULATION_TIME_WINDOW_SECONDS:.0f}-second window"
    )
    updated_nodes = []
    errors = []

    for raw_node in request_nodes or []:
        if not isinstance(raw_node, dict):
            continue
        node_id = raw_node.get("id")
        data = raw_node.get("data")
        if not isinstance(data, dict):
            continue

        node_copy = raw_node.copy()
        data_copy = data.copy()
        data_copy.update({
            "dirty": False,
            "error": True,
            "extendedError": detail,
        })
        data_copy.pop("scriptDebugSteps", None)
        node_copy["data"] = data_copy
        updated_nodes.append(node_copy)

        if isinstance(node_id, str):
            errors.append({"nodeId": node_id, "error": detail})

    if not errors:
        errors.append({"nodeId": "__calculation_budget__", "error": detail})

    payload = {
        "error": "calculation_time_limited",
        "detail": detail,
        "observedSeconds": observed,
        "version": version,
        "nodes": updated_nodes,
        "errors": errors,
    }
    return _json(payload, 429)

@app.errorhandler(429)
def handle_ratelimit(e):
    return _json({"error": "rate_limited", "detail": str(e.description)}, 429)

@app.errorhandler(413)
def handle_too_large(e):
    return _json({"error": "payload_too_large", "limit_bytes": app.config["MAX_CONTENT_LENGTH"]}, 413)

@app.errorhandler(Exception)
def handle_unexpected(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception("Unhandled server error")
    return _json({"error": "internal_server_error"}, 500)


def _find_flow_path(slug: str) -> Path | None:
    if not _FLOW_SLUG_PATTERN.match(slug):
        return None
    candidate = FLOWS_DIR / f"{slug}.json"
    try:
        candidate.resolve().relative_to(FLOWS_DIR.resolve())
    except ValueError:
        return None
    return candidate if candidate.exists() else None


@app.route("/flows", methods=["GET"])
@limiter.exempt
def list_flows():
    if not FLOW_CATALOG:
        return _json({"flows": []})

    resp = _json({"flows": FLOW_CATALOG})
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@app.route("/flows/<slug>", methods=["GET"])
@limiter.exempt
def get_flow(slug: str):
    path = _find_flow_path(slug)
    if path is None:
        return _json({"error": "flow_not_found"}, 404)

    try:
        payload = orjson.loads(path.read_bytes())
    except OSError:
        return _json({"error": "flow_not_readable"}, 500)

    resp = _json(payload)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp

@app.route('/bulk_calculate', methods=['POST'])
@limiter.limit("60/minute")
def bulk_calculate():
    raw = request.get_json(silent=True)
    if raw is None or not isinstance(raw, dict):
        return _json({"error": "Invalid JSON body"}, 400)

    nodes = raw.get('nodes')
    edges = raw.get('edges')
    version = raw.get('version', 0)

    if not isinstance(nodes, list) or not isinstance(edges, list):
        return _json({"error": "nodes and edges must be arrays"}, 400)

    client_ip = get_client_ip()
    check_wall_time = _budget_now()
    allowed, observed = computation_budget.check(client_ip, now=check_wall_time)
    if not allowed:
        app.logger.warning(
            "Rejected /bulk_calculate for %s: calculation budget exceeded (%.3fs in window)",
            client_ip,
            observed,
        )
        return _calculation_budget_error(
            observed,
            version=version,
            request_nodes=nodes,
        )

    started_at = time.perf_counter()
    try:
        updated_nodes, errors = bulk_calculate_logic(nodes, edges)
        updated_nodes_list = list(updated_nodes)

        if errors:
            return _json(
                {"nodes": updated_nodes_list, "version": version, "errors": errors},
                400,
            )
        return _json({"nodes": updated_nodes_list, "version": version})
    finally:
        duration = max(time.perf_counter() - started_at, 0.0)
        finish_wall_time = check_wall_time + duration
        computation_budget.record(client_ip, duration, now=finish_wall_time)

@app.route('/code', methods=['GET'])
@limiter.limit("30/minute")
def get_code():
    func_name = request.args.get('functionName')
    if func_name is None:
        return _json({"error": "Function name not provided"}, 400)

    func = GLOBAL_CALC_FUNCTIONS.get(func_name)
    if not func:
        return _json({"error": "Function not found"}, 404)

    try:
        source = inspect.getsource(func)
        expanded = expand_function_source(func, source)
        resp = _json({"code": expanded})
        # Cache for 15 minutes to reduce load while keeping code views fresh.
        resp.headers["Cache-Control"] = "public, max-age=900"
        return resp
    except OSError:
        return _json({"code": "Source not available"}, 200)

@app.route('/healthz', methods=['GET'])
@limiter.exempt
def healthz():
    return _json({
        "ok": True,
        "version": APP_VERSION,
        "limits": {
            "maxPayloadBytes": app.config.get("MAX_CONTENT_LENGTH"),
            **public_limits(),
        },
    })


# ---------------------------------------------------------------------------
# Bitcoin Core integration (local installs only)
#
# Disabled unless Flask runs in debug mode (python routes.py) or
# RAWBIT_BITCOIN_RPC_ENABLED is set — the hosted backend must never expose
# a path to its local network.
# ---------------------------------------------------------------------------

bitcoin_rpc_client = BitcoinRPC()

# Loopback hostnames accepted in the Host header. Port is ignored so a custom
# PORT still works; what matters is that the browser addressed the node by a
# local name, which a DNS-rebinding page (Host: evil.com) cannot forge.
_BITCOIN_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


def _bitcoin_endpoints_enabled() -> bool:
    return bitcoin_rpc_enabled() or app.debug


def _bitcoin_guard():
    """Reject any request that must not reach the local node.

    Returns an error Response to short-circuit, or None to proceed. Defends a
    money-daemon bridge that otherwise leans only on browser-enforced CORS:
      * loopback-only client    → blocks LAN access when bound to 0.0.0.0
      * Host header allowlist    → blocks DNS-rebinding (Host stays the attacker's)
    """
    if not _bitcoin_endpoints_enabled():
        return _json({"error": {"message": "Bitcoin Core endpoints are disabled."}}, 404)
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return _json({"error": {"message": "Bitcoin Core endpoints are loopback-only."}}, 403)
    host = (request.host or "").rsplit(":", 1)[0].lower()
    if host not in _BITCOIN_LOCAL_HOSTS:
        return _json(
            {"error": {"message": "Bitcoin Core endpoints reject non-local Host headers."}}, 403
        )
    return None


@app.route('/bitcoin/status', methods=['GET'])
@limiter.limit("60/minute")
def bitcoin_status():
    blocked = _bitcoin_guard()
    if blocked is not None:
        return blocked
    try:
        return _json(bitcoin_rpc_client.status())
    except (BitcoinRPCUnavailable, BitcoinRPCError) as exc:
        # "no node" is a normal state for the console, not an HTTP failure
        return _json({"connected": False, "error": str(exc)})


@app.route('/bitcoin/rpc', methods=['POST'])
@limiter.limit("120/minute")
def bitcoin_rpc_command():
    blocked = _bitcoin_guard()
    if blocked is not None:
        return blocked
    payload = request.get_json(silent=True) or {}
    method = payload.get("method")
    params = payload.get("params", [])
    if not isinstance(method, str) or not method.strip():
        return _json({"error": {"message": "Missing RPC method."}}, 400)
    if not isinstance(params, (list, dict)):
        return _json({"error": {"message": "Params must be a JSON array or object."}}, 400)
    try:
        return _json({"result": bitcoin_rpc_client.call_gated(method, params)})
    except BitcoinRPCForbidden as exc:
        return _json({"error": {"message": str(exc)}}, 403)
    except BitcoinRPCError as exc:
        # bitcoind-level errors are legitimate console output
        return _json({"error": {"code": exc.code, "message": exc.message}})
    except BitcoinRPCUnavailable as exc:
        return _json({"error": {"message": str(exc)}}, 503)


@app.route('/bitcoin/rebuild', methods=['POST'])
@limiter.limit("30/minute")
def bitcoin_rebuild():
    blocked = _bitcoin_guard()
    if blocked is not None:
        return blocked
    payload = request.get_json(silent=True) or {}
    ref = payload.get("tx")
    if not isinstance(ref, str) or not ref.strip():
        return _json({"error": {"message": "Provide a txid or raw transaction hex."}}, 400)
    try:
        dataset = build_rebuild_dataset(bitcoin_rpc_client, ref)
        flow = generate_legacy_flow(dataset)
        return _json({"flow": flow, "txid": dataset["txid"]})
    except UnsupportedTransaction as exc:
        return _json({"error": {"message": str(exc)}}, 422)
    except RebuildError as exc:
        return _json({"error": {"message": str(exc)}}, 400)
    except (BitcoinRPCForbidden, BitcoinRPCError, BitcoinRPCUnavailable) as exc:
        return _json({"error": {"message": str(exc)}}, 503)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv("PORT", "5007")), debug=True)
