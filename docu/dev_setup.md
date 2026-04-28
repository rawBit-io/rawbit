# Developer Setup

This guide collects the extra setup steps and tooling notes that make day‑to‑day
development smoother. Follow the [README Quick start](../README.md#quick-start-local)
to get the app running, then apply the optimizations below.

## Fresh macOS bootstrap

For a brand-new Mac without a toolchain. If you already have Homebrew, Node, and
Python set up, skip to the README's Quick start.

```bash
# Compilers & headers
xcode-select --install

# Homebrew (installs under /opt/homebrew on Apple Silicon, /usr/local on Intel)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

# Runtime dependencies
brew install node@20 python@3.12 pkg-config secp256k1
```

`node@20` is keg-only on Homebrew, so add it to `PATH` if `node --version`
doesn't pick it up:

```bash
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

Replace `/opt/homebrew` with `/usr/local` on Intel Macs.

## Python Environment Tips

- Prefer a local virtual environment (`python -m venv .myenv`) so editable
  installs and per-project dependencies do not leak into the global Python
  interpreter.
- After installing requirements, run a quick smoke test to make sure the Python
  bindings can see the system `secp256k1` library:

  ```bash
  python - <<'PY'
  import secp256k1
  print("secp256k1 loaded:", secp256k1.__version__)
  PY
  ```

- If the import fails, verify that the system-level library is installed and
  reinstall the Python bindings with `pip install --no-binary=:all: secp256k1`.

## IDE / Type Checking (Pyright)

We check type hints with [Pyright](https://github.com/microsoft/pyright). To
avoid "Import could not be resolved" errors for the editable `python-bitcointx`
dependency, add the virtual environment’s paths to `pyrightconfig.json`:

```json
{
  "typeCheckingMode": "basic",
  "extraPaths": [
    ".myenv/src/python-bitcointx"
  ]
}
```

- Relative paths are resolved from the repository root. If your editable install
  lives elsewhere, swap in the absolute path to that directory.
- You can tighten type checking (`standard` or `strict`) once the codebase is
  clean under `basic`.

Run Pyright manually with:

```bash
node_modules/.bin/pyright
```

or rely on the VS Code extension for on-save diagnostics.

## Environment Overrides

Tracked env files provide the defaults used by local development, Playwright,
and deployment scripts. For private overrides, use shell environment variables
or an ignored mode-local file such as `.env.development.local`. Do not put
secrets in tracked env files.

```bash
# Optional: point local dev at a remote backend.
VITE_ALLOW_REMOTE_API=true
VITE_API_BASE_URL=https://api-dev.rawbit.io

# Optional: only needed if you run a share service locally.
VITE_SHARE_BASE_URL=http://localhost:8787
```

See `.env.example` for the full list of supported environment flags you can copy
as a baseline.

## JavaScript Tooling

Vite, ESLint, and Vitest are already configured via `npm install`. Useful
commands:

- `npm run lint` – type-aware ESLint pass over the frontend.
- `npm run typecheck` – TypeScript project references for the app, worker, and E2E tests.
- `npm run test` – frontend unit/integration suite.
- `npm run test:e2e` – Playwright end-to-end tests (backend must be running).

Install Playwright browsers once with `npx playwright install`.

## Backend Testing

Backend tests live in `backend/tests`. To run them directly:

```bash
python -m pytest backend/tests
```

The helper script `python3 run_all_tests.py` drives lint, typecheck, frontend,
E2E, and backend suites sequentially and respects the `RUN_ALL_TESTS_*`
overrides documented in the README.

## Logging & Debugging

- The backend reads configuration from `backend/config.py`; override values with
  environment variables when debugging rate limits or calculation budgets.
- Use `FLASK_DEBUG=1 python backend/routes.py` for interactive reloading during
  API development.
