# Developer Setup

This guide collects extra setup steps and tooling notes for local development.
Follow the [README Quick start](../README.md#quick-start-local) to get the app
running, then apply the optimizations below as needed.

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

## IDE Type Hints

The repository does not ship a Python type-checking command. If your editor uses
Pyright or Pylance and reports "Import could not be resolved" for the editable
`python-bitcointx` dependency, add the virtual environment's paths to a local
`pyrightconfig.json`:

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
- This is optional editor configuration. The tracked project checks currently
  use `npm run typecheck` for TypeScript and `python -m pytest backend/tests`
  for backend validation.

## Environment Overrides

The tracked `.env` file provides defaults used by local development and tests.
For private overrides, use shell environment variables or an ignored mode-local
file such as `.env.development.local`. Do not put secrets in tracked env files.

```bash
# Optional: point local dev at a remote backend.
VITE_ALLOW_REMOTE_API=true
VITE_API_BASE_URL=https://api-dev.rawbit.io

# Optional: only useful if you run a compatible share service locally.
VITE_SHARE_BASE_URL=http://localhost:8787
```

Share links require an external service that implements `POST /share` and
`GET /s/<id>`; that service is not included in this repository.

## JavaScript Tooling

Vite, ESLint, and Vitest are already configured via `npm install`. Useful
commands:

- `npm run lint` - ESLint pass over the frontend.
- `npm run typecheck` - TypeScript project references for the app, worker, and E2E tests.
- `npm run test` - frontend unit/integration suite.
- `npm run test:e2e` - Playwright end-to-end tests. Start the backend first, or
  use `python3 run_all_tests.py` to let the helper start it for you.

Install Playwright browsers once with `npx playwright install`.

## Backend Testing

Backend tests live in `backend/tests`. To run them directly:

```bash
python -m pytest backend/tests
```

The helper script `python3 run_all_tests.py` drives lint, typecheck, frontend,
E2E, and backend suites sequentially and respects the `RUN_ALL_TESTS_*`
overrides documented in [run-all-tests.md](./run-all-tests.md).

## Logging & Debugging

- The backend reads configuration from `backend/config.py`; override values with
  environment variables when debugging rate limits or calculation budgets.
- Use `FLASK_DEBUG=1 python backend/routes.py` for interactive reloading during
  API development.
