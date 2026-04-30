# Backend Overview

The backend is a lightweight Python/Flask API that powers rawBit's canvas
calculations and lesson catalogue. It is designed for education: given a graph
of calculation nodes, it resolves inputs, runs the matching Python helpers, and
returns updated node data for the frontend to render.

## Responsibilities

- Evaluate calculation graphs submitted by the client.
- Serve the bundled lesson-flow catalogue from `src/my_tx_flows/`.
- Return backend helper source code for node code views and LLM exports.
- Expose health and limit metadata for local scripts and deployed clients.
- Enforce payload, rate, timeout, and computation-budget limits.

## Stack

- Flask app: `backend/routes.py`
- Calculation dispatcher: `backend/graph_logic.py`
- Calculation helpers: `backend/calc_functions/calc_func.py`
- Function metadata: `backend/calc_functions/function_specs.py`
- Source expansion for code views: `backend/codeview_expander.py`
- Optional shared budget backend: Redis via `RAWBIT_REDIS_URL`

## API Surface

All endpoints share the Flask app in `backend/routes.py`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/bulk_calculate` | Evaluate a graph and return updated nodes, version, and per-node errors. |
| `GET` | `/flows` | List bundled lesson flows with labels and API paths. |
| `GET` | `/flows/<slug>` | Return one bundled flow JSON by safe slug. |
| `GET` | `/code?functionName=...` | Return Python source for a calculation helper, with selected support code expanded. |
| `GET` | `/healthz` | Return health, app version, and public calculation limits. |

## Calculation Pipeline

`/bulk_calculate` expects the frontend graph shape: `nodes`, `edges`, and an
optional `version`.

1. Invalid edges are filtered and annotated so the UI can show precise errors.
2. Nodes are topologically sorted; cycles are marked and skipped.
3. Group, text-info, and Trezor action nodes are treated as non-calculation
   nodes.
4. Inputs are resolved from connected edges and manual fields according to
   `FUNCTION_SPECS`.
5. Runtime sentinel values such as `__FORCE00__`, `__EMPTY__`, and `__NULL__`
   are converted before helper execution.
6. Numeric inputs declared in `FUNCTION_SPECS` are coerced to `int` or `float`.
7. The selected helper from `CALC_FUNCTIONS` runs, and special outputs such as
   script debug steps, Taproot tree paths, or MuSig2 nonce side outputs are
   written back into node data.
8. The response returns updated nodes plus an `errors` array when any node fails.

## Limits

Defaults come from `backend/config.py` and can be overridden with environment
variables.

| Limit | Default | Env |
| --- | ---: | --- |
| Max request body | 5 MB | Flask `MAX_CONTENT_LENGTH` |
| Per-calculation timeout | 5 seconds | `RAWBIT_CALCULATION_TIMEOUT_SECONDS` |
| Computation budget | 10 seconds per window | `RAWBIT_CALCULATION_BUDGET_SECONDS` |
| Budget window | 60 seconds | `RAWBIT_CALCULATION_WINDOW_SECONDS` |
| Shared budget store | off | `RAWBIT_REDIS_URL` |

`/bulk_calculate` also has a Flask-Limiter fallback of `60/minute`, `/code` has
`30/minute`, and the default route limit is `200/minute`. Hosted deployments can
put Cloudflare or another edge limiter in front of the Flask app; local
development uses the in-process limits.

## Source Code Views

The `/code` endpoint returns source for one helper in `CALC_FUNCTIONS`.
`codeview_expander.py` prepends selected local helper code and constants for
educational functions that depend on Base58, Bech32, or BIP39 internals. The
frontend uses this endpoint for node code dialogs and for LLM exports.

## Running

```bash
python backend/routes.py
# or, for a multi-worker setup:
gunicorn -c backend/gunicorn_config.py --chdir backend routes:app
```

The development server listens on `http://localhost:5007`.

## Testing

Backend tests live under `backend/tests/`:

```bash
python -m pytest backend/tests
```

For the full local quality gate, use:

```bash
python3 run_all_tests.py
```

That script runs lint, typecheck, frontend Vitest, Playwright E2E, and backend
pytest sequentially.

## Extending

When adding a calculation helper:

1. Implement the logic in `backend/calc_functions/calc_func.py`.
2. Register it in `CALC_FUNCTIONS` in `backend/graph_logic.py`.
3. Add or update its entry in `backend/calc_functions/function_specs.py`.
4. Add or update frontend node metadata when the node needs a visible palette
   entry or custom UI.
5. Add backend tests and, for user-facing flows, update or add lesson JSON under
   `src/my_tx_flows/`.
