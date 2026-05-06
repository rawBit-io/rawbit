# Backend Overview

This project ships with a lightweight Python/Flask API that powers the flows
rendered in the frontend. The backend focuses on three jobs:

- Evaluate calculation graphs submitted by the client.
- Serve the catalogue of bundled flows.
- Surface helper metadata (source listings, health checks) so the UI can stay
  in sync with the server version.

## Stack at a Glance

- **Framework:** Flask with `flask-cors` and `flask-compress` to handle CORS and
  gzip out of the box.
- **Structure:** Application factory lives in `backend/routes.py`; calculation
  helpers reside under `backend/calc_functions/`.
- **Data:** Flow examples are plain JSON files in `src/my_tx_flows/`.

## HTTP Endpoints

All endpoints share the same Flask app (`backend/routes.py`):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/bulk_calculate` | Execute a graph of calculation nodes and return the results (or per-node errors) in the same shape the frontend expects. |
| `GET` | `/flows` | List the built-in flows bundled with the repository. |
| `GET` | `/flows/<slug>` | Fetch a single flow JSON by slug. |
| `GET` | `/code` | Return the source for a calculation helper so the UI can display inline docs. |
| `GET` | `/healthz` | Minimal health probe used by scripts/tests to confirm the API is ready. |

## Flow Evaluation

`/bulk_calculate` expects the frontend’s graph format:

1. The request body contains nodes keyed by ID, each with a `functionName` and
   input/output handles.
2. The backend loads the requested function from `backend/calc_functions/` and
   executes it with the provided parameters.
3. Results are sent back per node. Errors are returned alongside a message so
   the UI can highlight the offending step.

The evaluator walks the graph in topological order, caching intermediate values
 so repeated lookups stay fast during multi-node flows.

## Running the Backend

Local development is straightforward:

```bash
python backend/routes.py
# or, for a multi-worker setup:
gunicorn -c backend/gunicorn_config.py --chdir backend routes:app
```

`gunicorn_config.py` ships with sensible defaults for a laptop install. Feel
free to tweak worker counts or ports if you embed the backend in another
environment.

## Testing

Backend tests live under `backend/tests/` and can be run directly:

```bash
python -m pytest backend/tests
```

The convenience script `python3 run_all_tests.py` executes both backend and
frontend suites sequentially if you want a single command before tagging a
release.

## Extending the API

When you add a new calculation helper:

1. Implement the logic in `backend/calc_functions/calc_func.py`.
2. Update the specification in `backend/calc_functions/function_specs.py` so the
   evaluator knows the input/output handles.
3. Add or update flow JSON files under `src/my_tx_flows/` if the feature needs
   a new example.
4. Cover the behavior with tests (`backend/tests/`) and ensure `python3
   run_all_tests.py` stays green.

That is all a local contributor needs; production-specific limits, secrets, and
hosting details stay in the private documentation.
