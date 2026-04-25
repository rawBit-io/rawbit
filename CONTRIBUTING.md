# Contributing to rawBit

rawBit is a visual educational tool for constructing and understanding Bitcoin transactions and protocol flows. This guide explains how to set up the project locally, how the codebase is structured, and how to contribute — whether that is a new lesson flow, a bug fix, a documentation improvement, or a quality-of-life enhancement.

If you are exploring rawBit as part of a structured program (such as Summer of Bitcoin), start by reading [`docu/contribute.md`](docu/contribute.md) for a broader overview of contribution directions, then come back here for the technical details.

---

## Table of Contents

1. [Prerequisites and Local Setup](#1-prerequisites-and-local-setup)
2. [Project Structure](#2-project-structure)
3. [Architecture Overview](#3-architecture-overview)
4. [How to Add a New Lesson Flow](#4-how-to-add-a-new-lesson-flow)
5. [How to Add a New Calculation Node (Backend)](#5-how-to-add-a-new-calculation-node-backend)
6. [How to Add a New Frontend Node Type](#6-how-to-add-a-new-frontend-node-type)
7. [Testing](#7-testing)
8. [Code Style and Conventions](#8-code-style-and-conventions)
9. [Submitting a Pull Request](#9-submitting-a-pull-request)
10. [Good First Contributions](#10-good-first-contributions)

---

## 1. Prerequisites and Local Setup

### System requirements

| Tool | Minimum version |
|---|---|
| Node.js | 18+ |
| npm / pnpm / yarn | any recent |
| Python | 3.12+ |
| pip | latest |
| C compiler + `libsecp256k1` | required by `python-bitcointx` |

### macOS bootstrap (fresh machine)

```bash
# Compilers and headers
xcode-select --install

# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"

# Runtime dependencies
brew install node@20 python@3.12 pkg-config secp256k1
```

### Clone and install

```bash
git clone https://github.com/rawBit-io/rawbit.git
cd rawbit

# Frontend dependencies
npm install

# Backend virtualenv
python3 -m venv .myenv
source .myenv/bin/activate          # Windows: .myenv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-special.txt
```

### Run locally

Open two terminals from the project root:

**Terminal 1 — Frontend (Vite dev server):**
```bash
npm run dev
# → http://localhost:3041/
```

**Terminal 2 — Backend (Flask API):**
```bash
source .myenv/bin/activate
python3 backend/routes.py
# → http://localhost:5007/
```

Open [http://localhost:3041/](http://localhost:3041/) in your browser. The UI fetches lesson flows from `/flows` and sends calculation requests to `/bulk_calculate` on the backend.

> **Note:** The `.env` file at the project root configures `VITE_API_BASE_URL`. The default points at `http://localhost:5007`. You do not need to change this for local development.

For extended setup notes (Playwright browser install, environment variable overrides, Intel vs Apple Silicon paths), see the main [`README.md`](README.md#quick-start-local).

---

## 2. Project Structure

```
rawbit/
├── src/                        # Frontend (React + TypeScript)
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/             # UI components (canvas, panels, dialogs, nodes)
│   ├── contexts/               # React contexts (UndoRedo, Snapshot, FlowActions)
│   ├── hooks/                  # Core logic hooks (calculation, interactions, tabs)
│   ├── lib/                    # Utility functions
│   ├── types/                  # Shared TypeScript types
│   ├── my_tx_flows/            # ← Lesson flow JSON files live here
│   ├── workers/                # Web workers
│   └── integration/            # Integration test helpers
│
├── backend/                    # Backend (Python + Flask)
│   ├── routes.py               # Flask app + all endpoints
│   ├── graph_logic.py          # Topological evaluation of calculation graphs
│   ├── computation_budget.py   # Per-request computation time limits
│   ├── calc_functions/
│   │   ├── calc_func.py        # ← All calculation node implementations
│   │   └── function_specs.py  # ← Node input/output handle specifications
│   └── tests/                  # Backend pytest test suite
│
├── docu/                       # Documentation
│   ├── contribute.md           # Contribution directions overview
│   ├── frontend-architecture.md
│   ├── backend-overview.md
│   ├── api.md
│   ├── l-sum.md                # Lesson summaries
│   └── dev_setup.md
│
├── README.md
├── CHANGELOG.md
├── requirements.txt
├── requirements-special.txt    # Pinned python-bitcointx fork
└── run_all_tests.py            # Run frontend + backend tests together
```

---

## 3. Architecture Overview

rawBit has two independently runnable processes that communicate over HTTP.

### Frontend (React + Vite + TypeScript)

The frontend manages the visual canvas, user interactions, tab state, undo/redo history, and script debugger UI. It is built on:

- **`@xyflow/react`** (React Flow) — the node-and-edge canvas
- **Vite** — development server and bundler
- **Tailwind CSS** — styling

Key files to know before contributing:

| File / Directory | What it does |
|---|---|
| `src/components/Flow.tsx` | Top-level canvas composition; wraps providers and orchestrates all hooks |
| `src/hooks/useNodeOperations.ts` | All graph mutations (add, delete, group, drag, drop, template placement) |
| `src/hooks/useCalculation.ts` | Debounced recalculation: detects dirty nodes → calls backend → merges results |
| `src/hooks/useFlowInteractions.ts` | Undo-friendly interaction layer built on top of `useNodeOperations` |
| `src/contexts/UndoRedoContext.tsx` | Per-tab history with up to 50 snapshots including script-step payloads |
| `src/my_tx_flows/` | All lesson JSON files; adding a file here makes it appear in the lesson sidebar |

**Data flow summary:**
1. User interaction → handler in `useNodeOperations` / `useFlowInteractions`
2. Dirty nodes scheduled → `useGlobalCalculationLogic` debounces and calls backend
3. Backend response merges back into the graph, clearing dirty flags
4. `UndoRedoProvider` records a clean snapshot

### Backend (Python + Flask)

The backend evaluates calculation graphs submitted by the frontend. It does not own any UI state.

Key files:

| File | What it does |
|---|---|
| `backend/routes.py` | Flask app factory; all HTTP endpoints |
| `backend/graph_logic.py` | Walks the calculation graph in topological order, caches intermediate values |
| `backend/calc_functions/calc_func.py` | Every calculation node implementation (hashing, signing, serialization, script evaluation, etc.) |
| `backend/calc_functions/function_specs.py` | Declares input/output handle names and types for every node function |

**Endpoints used by the UI:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/bulk_calculate` | Evaluate a graph of calculation nodes; returns per-node results or errors |
| `GET` | `/flows` | List all bundled lesson flows |
| `GET` | `/flows/<slug>` | Fetch a single lesson flow JSON by slug |
| `GET` | `/code` | Return the Python source of a calculation function (used by the node inspector) |
| `GET` | `/healthz` | Health probe |

---

## 4. How to Add a New Lesson Flow

A lesson flow in rawBit is a JSON file stored in `src/my_tx_flows/`. The frontend discovers these files automatically — no registration step is needed.

### Step 1 — Design the flow first

Before writing any JSON, sketch the flow on paper or in a drawing tool:
- What concept does this lesson teach?
- What is the simplest canvas that shows it clearly?
- What are the input nodes (keys, UTXOs, amounts)?
- What are the intermediate nodes (hashing, signing, script construction)?
- What is the final output (transaction bytes, TXID, script execution result)?

Refer to [`docu/contribute.md`](docu/contribute.md#design-philosophy-for-flows) for design principles on keeping flows clear and avoiding canvas overload.

### Step 2 — Build interactively on the canvas

The fastest way to create a flow is to build it in the live editor:
1. Start a new tab in rawBit
2. Drag and connect nodes until the concept is visually clear and all values compute correctly
3. Verify the result against a known testnet transaction or a reference implementation

### Step 3 — Export the JSON

Use the **Save/Export** button in the editor to export your completed canvas as a JSON file.

### Step 4 — Add the file to `src/my_tx_flows/`

Place the exported JSON in `src/my_tx_flows/`. The filename becomes the flow's slug. Follow the existing naming pattern:

```
lesson-01-p2pkh.json
lesson-08-segwit-p2wpkh.json
lesson-14-musig2.json
```

### Step 5 — Verify in the sidebar

Restart the frontend dev server. Your new lesson should appear in the **Flow Examples** sidebar. Load it, confirm all nodes compute correctly, and check that the canvas layout is clear.

### Step 6 — Add a lesson summary entry

Add a summary of your lesson to [`docu/l-sum.md`](docu/l-sum.md) following the existing format. Include:
- The concept taught
- Which Bitcoin primitives are involved
- Which testnet transaction verifies it (if applicable)

---

## 5. How to Add a New Calculation Node (Backend)

Each node in a rawBit flow corresponds to a Python function in `backend/calc_functions/calc_func.py`. When the frontend sends a graph to `/bulk_calculate`, the backend looks up the function by `functionName` and calls it with the provided inputs.

### Step 1 — Implement the function in `calc_func.py`

Add your function to `backend/calc_functions/calc_func.py`:

```python
def my_new_node(input_a: str, input_b: str) -> dict:
    """
    Brief description of what this node computes.
    Returns a dict whose keys match the output handle names in function_specs.py.
    """
    result = do_something(input_a, input_b)
    return {
        "output_handle_name": result,
    }
```

**Conventions:**
- All inputs and outputs are strings or dicts of strings (hex, decimal, or structured data)
- Raise a descriptive `ValueError` if inputs are invalid — the frontend displays this error inline on the node
- Keep the function pure (no side effects, no global state)

### Step 2 — Register the node in `function_specs.py`

Add an entry to `backend/calc_functions/function_specs.py` that declares the input and output handle names:

```python
"my_new_node": {
    "inputs": ["input_a", "input_b"],
    "outputs": ["output_handle_name"],
},
```

The handle names here must exactly match the parameter names in your Python function (inputs) and the dict keys your function returns (outputs).

### Step 3 — Write a backend test

Add a test in `backend/tests/` to verify your function's behavior:

```python
def test_my_new_node():
    from calc_functions.calc_func import my_new_node
    result = my_new_node("valid_input_a", "valid_input_b")
    assert result["output_handle_name"] == "expected_value"
```

Run with:
```bash
source .myenv/bin/activate
pytest backend/tests
```

### Step 4 — Use the node in a flow JSON

After registering the function, you can place nodes with `"functionName": "my_new_node"` in a flow JSON and connect handles by their declared names.

---

## 6. How to Add a New Frontend Node Type

Most new flows can reuse existing node components from the rawBit node library. However, if a new concept requires a visual representation that does not exist yet, you can add a new React node component.

### Step 1 — Identify the right location

Node components live in `src/components/`. Look at existing node implementations to understand the expected props interface — each node receives its data and connection handles via React Flow's standard `NodeProps`.

### Step 2 — Create the component

Create a new file in `src/components/` following the existing naming pattern. Your component should:
- Accept `NodeProps` from `@xyflow/react`
- Render input and output `Handle` components for each connection point
- Display the computed value (passed in via node data) when available
- Show an error state if the backend returned an error for this node

### Step 3 — Register the node type

Register your new component in the `nodeTypes` object that is passed to `<ReactFlow>`. This is located in `src/components/Flow.tsx`. Add an entry:

```typescript
const nodeTypes = {
  // ... existing types
  myNewNodeType: MyNewNodeComponent,
};
```

### Step 4 — Test it in a flow

Add a node with `"type": "myNewNodeType"` to a flow JSON and verify it renders, connects, and updates correctly in the live editor.

---

## 7. Testing

rawBit has three test layers:

### Backend unit tests (Python + pytest)

```bash
source .myenv/bin/activate
pytest backend/tests
```

Covers calculation functions, graph evaluation, and edge cases. The MuSig2 path is validated against official BIP327 vectors:

```bash
pytest backend/tests/test_musig2_bip327_vectors.py
```

### Frontend lint and unit tests (TypeScript + Vitest)

```bash
npm run lint
npm run test
```

### End-to-end tests (Playwright)

```bash
npx playwright install   # first run only
npm run test:e2e
```

### Run everything at once

```bash
python3 run_all_tests.py
```

Add `--e2e-browsers=all` to also run E2E tests in Firefox and WebKit.

**Before submitting a PR:** run `python3 run_all_tests.py` and confirm it passes. If your change adds a new calculation node, add backend tests. If it adds a new lesson flow, manually verify all nodes compute correctly and no edges are broken.

---

## 8. Code Style and Conventions

### TypeScript / Frontend

- TypeScript strict mode is enabled — no `any` without justification
- Use existing hook patterns (`useNodeOperations`, `useFlowInteractions`) as the entry point for any new graph mutations — do not mutate React Flow state directly
- Prefer small, focused hooks over large monolithic components
- Follow the existing file naming convention (`camelCase.ts` for hooks and utilities, `PascalCase.tsx` for components)

### Python / Backend

- Functions in `calc_func.py` should be pure and stateless
- Raise `ValueError` with a clear message for invalid inputs — the frontend displays this message directly to the user
- Match the output dict keys exactly to the handle names declared in `function_specs.py`
- Add type hints to new functions

### JSON Lesson Files

- Use lowercase hyphenated filenames: `lesson-15-lightning-htlc.json`
- Node IDs should be descriptive strings, not random UUIDs, so diffs are readable
- Keep the canvas layout readable: avoid crossing edges where possible, group related nodes

---

## 9. Submitting a Pull Request

### Before you open a PR

1. **Fork** the repository and create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-contribution
   ```
2. Make your changes, following the conventions above
3. Run `python3 run_all_tests.py` — all tests must pass
4. Verify your change in the live editor at `localhost:3041`

### PR title format

Use a short, descriptive title. Examples:
- `docs: add CONTRIBUTING.md with lesson and node authoring guide`
- `feat: add CoinJoin lesson flow (lesson-15)`
- `fix: correct merkle root calculation for odd transaction counts`
- `test: add backend tests for P2TR script-path node`

### PR description

Include:
- **What** this PR changes
- **Why** it is useful (educational value, bug fix, quality improvement)
- **How to verify** — what to load in the editor, what to look for in the output
- A testnet transaction link if your lesson flow involves a broadcast transaction

### What maintainers look for

- Does the change improve educational clarity?
- Are new calculation nodes tested?
- Is the canvas layout readable for a first-time viewer?
- Does the existing test suite still pass?
- Is the code consistent with the existing patterns?

---

## 10. Good First Contributions

If you are new to the codebase and looking for a starting point, these are good entry points:

**Documentation:**
- Review an existing lesson for clarity and suggest improvements in [`docu/l-sum.md`](docu/l-sum.md)
- Add inline comments to a calculation function in `calc_func.py` that is currently uncommented
- Improve the setup instructions in `docu/dev_setup.md` for Linux/Windows users

**Small code contributions:**
- Add a missing edge case test in `backend/tests/`
- Fix a node label or description that is ambiguous
- Improve error messages returned by a calculation function so they are more actionable for the user

**New lesson flows (smaller scope):**
- A focused lesson on CLTV vs CSV comparison
- A "why this transaction is invalid" debugging lesson for a common mistake
- A PSBT basics flow showing the separation of creation, signing, and finalization

For larger contributions (new protocol areas like Lightning or Mining), it is best to open a discussion or reach out on [Discord](https://discord.gg/5vRnYSZc) first to align on scope before writing code.

---

## Questions and Discussion

Join the rawBit [Discord](https://discord.gg/5vRnYSZc) for questions, flow design discussions, and contributor coordination.

For bugs and feature proposals, open an [issue on GitHub](https://github.com/rawBit-io/rawbit/issues).
