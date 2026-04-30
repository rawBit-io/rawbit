# Run-All-Tests Script

This helper lives at `run_all_tests.py` (repo root) and orchestrates the local
quality gate: frontend lint, TypeScript typecheck, frontend Vitest, Playwright
E2E, and backend pytest. It prints a compact summary at the end and accepts a
few knobs so you can trade speed for coverage without editing source.

## Basic Usage

- `python3 run_all_tests.py` - default run. Executes lint, typecheck, frontend
  unit/integration tests, Playwright E2E against Chromium only, then the backend
  pytest suite.
- `python3 run_all_tests.py --e2e-browsers=all` - same lint, typecheck,
  frontend, and backend coverage, but Playwright executes Chromium, Firefox,
  and WebKit sequentially. Each browser run uses a reduced worker pool to avoid
  `/bulk_calculate` throttling.
- Exit status bubbles up from any failing job. The summary block lists pass/fail
  along with parsed test counts and backend coverage when available.

## Browser Selection

- `--e2e-browsers=chromium` (default) keeps the loop fast (<2 minutes locally)
  and mirrors what most developers run between commits.
- `--e2e-browsers=all` launches three Playwright invocations in order. Because
  the runs are serialized, backend requests stay under the rate limit and
  clipboard fallbacks make Firefox/WebKit stable.
- You can still override the command entirely via `RUN_ALL_TESTS_E2E_CMD` when
  you need custom Playwright flags; in that case the `--e2e-browsers` argument
  is ignored.

## Environment Overrides

- `RUN_ALL_TESTS_LINT_CMD` - replace the default `npm run lint` invocation.
- `RUN_ALL_TESTS_TYPECHECK_CMD` - replace the default `npm run typecheck`
  invocation.
- `RUN_ALL_TESTS_FRONTEND_CMD` - replace the default `npm run test` invocation
  (example: `vitest --run --changed` for diff-only loops).
- `RUN_ALL_TESTS_E2E_CMD` - replace the Playwright command wholesale. Use when
  you need a different project set, tracing mode, or headed execution.
- `RUN_ALL_TESTS_BACKEND_CMD` - replace pytest (example: `tox -e py`). When
  unset, the script auto-detects the local `.myenv` virtualenv and falls back to
  `python -m pytest` otherwise.
- `RUN_ALL_TESTS_BASE_URL` - replace the default frontend URL
  (`http://127.0.0.1:3041`) used by Playwright.
- `RUN_ALL_TESTS_API_URL` - replace the default backend URL
  (`http://localhost:5007`) used by Playwright and the frontend.
- `RUN_ALL_TESTS_SKIP_BACKEND=1` - require an already-running local backend
  instead of letting the helper start `backend/routes.py`.

## Tips

- Playwright targets the frontend at `http://127.0.0.1:3041`; the Playwright
  `webServer` config starts `npm run dev` automatically when needed.
- The helper runs entirely against your local stack by default. If nothing is
  already listening on `http://localhost:5007`, it spawns
  `.myenv/bin/python backend/routes.py` automatically and tears it down after
  the run. Set `RUN_ALL_TESTS_SKIP_BACKEND=1` when you want to manage the
  backend process yourself.
- For direct Playwright usage outside the script, prefer
  `npm run test:e2e -- --project=<browser>` sequentially to match the script's
  throttling-friendly behaviour.
- When Firefox or WebKit decline clipboard permissions, the tests use an
  in-page spy buffer so the assertions still work; Chromium retains the native
  API via `grantPermissions`.
