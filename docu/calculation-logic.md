# How Frontend Nodes and Backend Calculation Logic Fit Together

This guide traces the complete path from a user editing a canvas node to a recalculated result appearing on screen. 

Before reading this guide, browse at least one rawBit lesson to get a concrete picture of how nodes and wires look on the canvas. Setup instructions are in the [Quick start section of the README](../README.md).

---

## The Big Picture

rawBit separates two concerns across a frontend and a backend:

| Side     | Technology                      | Responsibility                                                                              |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| Frontend | React, Vite, `@xyflow/react`    | Renders nodes and edges on the canvas, tracks which nodes need recalculation and manages UI state |
| Backend  | Python, Flask                   | Evaluates the Bitcoin math for each calculation node and returns results                    |

The two sides communicate through a single HTTP endpoint: `POST /bulk_calculate`. The frontend sends a subgraph (a subset of nodes and edges) to this endpoint. The backend processes the nodes in topological order and returns the same nodes with their `result` fields filled in. The frontend merges those results back into the full canvas graph.

With that picture in mind, the next section explains what a node actually contains and how its internal fields drive the calculation cycle.

---

## What Is a Calculation Node?

Every box on the canvas is a React Flow `Node` object. Two node types are purely structural and never participate in calculations:

- `shadcnGroup` groups other nodes visually and performs no computation.
- `shadcnTextInfo` displays a text annotation on the canvas.

Every other node has `type: "calculation"`. Its `data` field is a `CalculationNodeData` object (defined in `src/types/flow.ts`) and serves as the contract between the frontend and the backend:

```jsonc
{
  "id": "node_abc123",
  "type": "calculation",
  "data": {
    "functionName": "hash160_hex",
    "dirty": true,
    "value": "04a1b2...",
    "inputs": { "val": "04a1b2..." },
    "inputStructure": { ... },
    "result": "f3e2d1...",
    "error": false,
    "extendedError": null
  }
}
```

The following fields are central to how the calculation cycle works:

| Field            | TypeScript type    | Written by                                                                                                                   | Purpose                                                                                                                  |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `functionName`   | `string`           | Set once in the flow JSON. Not changed at runtime                                                                            | Names the entry in `CALC_FUNCTIONS` that the backend calls for this node                                                 |
| `dirty`          | `boolean`          | Set to `true` by `useNodeCalculationLogic` when the user edits a field or connects a wire. Cleared to `false` by the backend after processing | Signals that this node's output is stale and must be recalculated                                                        |
| `value`          | `string`           | Typed by the user in the node's input field                                                                                  | Provides a fallback input when no upstream wire is connected; used by `single_val` nodes                                 |
| `inputs`         | `object`           | Written by the backend after each successful run                                                                             | Stores the resolved parameters used in the last execution; displayed in the node inspector                               |
| `inputStructure` | `InputStructure`   | Set once in the flow JSON; not changed at runtime                                                                            | Describes the visible input fields and their indices; the backend reads this to build ordered parameter lists for `multi_val` nodes |
| `result`         | `unknown`          | Written by the backend after each successful run                                                                             | The function's return value; downstream nodes read this via the `get_res` closure in `bulk_calculate_logic`              |
| `error`          | `boolean`          | Set to `true` by the backend on function failure or by the frontend on cycle or network error. Removed from `data` entirely (not set to `false`) by the backend on success | Marks whether the last execution failed                                                                                  |
| `extendedError`  | `string`           | Written on failure by the backend for calculation errors, or by the frontend for cycle detection, network errors, and timeouts. Stripped from the payload before each outgoing request | The human-readable error description shown in the node inspector                                                         |

---

## The Lifecycle of a Calculation

These nine steps trace the full path from a user interaction to a recalculated canvas. Each step leads directly into the next.

### Step 1: The user changes an input

When the user types in a node's text field, `useNodeCalculationLogic` in `src/hooks/useCalculation.ts` handles the change event. It updates `data.value` with the new text, sets `data.dirty` to `true` and clears `data.error` so the node does not continue showing a previous failure while the new input is being processed.

```ts
// src/hooks/useCalculation.ts, useNodeCalculationLogic
data: { ...node.data, value: newValue, dirty: true, error: false }
```

This is the only change made in this step. Downstream nodes are not marked dirty here. The system identifies them in the next steps by traversing the graph forward from this node.

### Step 2: The calculation hook detects the dirty flag and starts a debounce

`useGlobalCalculationLogic` in `src/hooks/useCalculation.ts` runs after every render. It scans the full node list for any node where `data.dirty` is `true` and `isCalculableNode` (from `src/lib/flow/nonCalculableNodes.ts`) returns `true`. When it finds at least one such node, it calls `onStatusChange("CALC")` to update the status banner and starts a 500 ms debounce timer using `window.setTimeout`. If the user keeps editing before the timer fires, it is cleared and restarted. This batches rapid edits into a single backend request rather than sending one per keystroke.

The 500 ms debounce delay is the default value of the `debounceMs` parameter in `useGlobalCalculationLogic`. It can be overridden at the call site if needed.

### Step 3: Compute the affected subgraph

When the debounce elapses without interruption, the hook calls `getAffectedSubgraph` in `src/lib/graphUtils.ts`. This function computes the minimal set of nodes and edges the backend needs to produce correct results.

It starts from the set of dirty nodes as seeds. It then runs two breadth-first searches: one backward through the graph using a reverse adjacency map to collect all ancestors (whose `result` values are needed as inputs to the dirty nodes), and one forward using a forward adjacency map to collect all descendants (whose outputs depend on the new result). Both sets are merged into a single affected subgraph.

There is **one special case**: if a `concat_all` node appears in the affected set, every node that feeds into it is added to the seeds and both searches run again. `concat_all` assembles its full ordered input list on every run, so all feeding branches must be present in the subgraph even if only one branch changed.

Nodes outside this subgraph are excluded from the request. For large flows this significantly reduces payload size.

### Step 4: Check for cycles before sending any request

`checkForCyclesAndMarkErrors` in `src/lib/graphUtils.ts` runs Kahn's topological-sort algorithm on the subgraph. The algorithm builds an in-degree map and repeatedly removes nodes whose in-degree reaches zero. If the count of processed nodes is smaller than the number of nodes in the subgraph, a cycle exists. Every node in the subgraph is immediately given:

```ts
data.error         = true;
data.extendedError = "Cycle detected in this sub-graph – calculation aborted.";
```

The backend is never called in this case. The user sees the error immediately on the canvas without waiting for a network round-trip.

If no cycle is found, the function returns `false` and execution continues to Step 5.

### Step 5: Strip UI-only fields and send the request

`recalculateGraph` in `src/lib/graphUtils.ts` builds the request body. Before serialising, it passes each node through `stripNodeForBackend`, which removes fields that are either large or irrelevant to the backend: `extendedError`, `scriptDebugSteps`, `scriptSteps`, `taprootTree`, `banner`, `tooltip`, `comment`, `showComment`, `searchMark`, and `groupFlash`. Sending these fields would inflate the payload without benefiting the calculation.

`recalculateGraph` also reads the backend's `maxPayloadBytes` limit (fetched once from `GET /healthz` and cached in `backendLimitsCache`). If the serialised payload exceeds this limit, the request is aborted before sending and all dirty nodes receive a size-limit error.

The request body sent to `POST /bulk_calculate` is:

```json
{
  "nodes": [ ... ],
  "edges": [ ... ],
  "version": 42
}
```

The `version` integer is incremented on every call to `recalculateGraph` via `++versionRef.current`. It is echoed back in the response so the frontend can detect and discard out-of-order replies. A 5-second `AbortController` timeout is applied to the `fetch` call. If the backend does not respond in time, all dirty nodes are marked with a timeout error and `onStatusChange("ERROR")` is called.

### Step 6: The backend sorts nodes and executes each one

The `POST /bulk_calculate` route in `backend/routes.py` performs a per-IP sliding-window budget check via `computation_budget.py` before passing the body to `bulk_calculate_logic` in `backend/graph_logic.py`. If the budget is already exhausted, it returns HTTP 429 immediately without running any calculations.

Inside `bulk_calculate_logic`:

**1. Edge sanitisation** `_sanitize_edges` drops any edge whose source or target node ID is not present in the payload. The affected nodes receive preflight errors. This is a defensive check and should not trigger during normal operation.

**2. Topological sort** `topological_sort` applies Kahn's algorithm to determine evaluation order, ensuring every node's input nodes are processed before it runs. Any nodes caught in a cycle are flagged by `_mark_cycle_errors` and skipped during execution.

**Node-by-node execution.** For each node ID in topological order:

1. `CALC_FUNCTIONS[node["data"]["functionName"]]` looks up the Python callable. If no matching entry exists, the node is marked with `error: True` and `extendedError: "No such function '...'"` and the loop moves to the next node.
2. `FUNCTION_SPECS[functionName]["paramExtraction"]` selects the builder from `PARAM_BUILDERS`. The available modes are `"none"`, `"single_val"`, `"multi_val"`, and `"val_with_network"` (described in the next section).
3. The selected builder resolves each input, reading upstream `result` values through the `get_res` closure or falling back to manually stored `inputs` text.
4. `validate_inputs` checks required fields and numeric type constraints defined in `FUNCTION_SPECS`. If a constraint is violated, a `ValueError` is raised before the callable is invoked.
5. The Python callable is invoked with the resolved parameters. Its return value is written to `node["data"]["result"]`. `node["data"]["dirty"]` is then set to `False` and the `error` key is removed from `data` via `data.pop("error", None)`.

The entire loop runs under the wall-clock budget set by `CALCULATION_TIMEOUT_SECONDS` in `backend/config.py`. If the budget is exceeded, `CalculationTimeoutError` is raised, all remaining dirty nodes are marked with an error message, and the partial results are returned immediately.

### Step 7: The backend returns its response

`bulk_calculate_logic` returns the updated node map and an error list to the route handler. The handler serialises the result and selects a status code:

- HTTP 200 with `{ "nodes": [...], "version": 42 }` when no node errors occurred.
- HTTP 400 with `{ "nodes": [...], "version": 42, "errors": [...] }` when at least one node failed.

The `nodes` array is included in both cases so the frontend can render the correct error state on the canvas rather than leaving nodes in an indeterminate state.

### Step 8: Merge results into the full graph

Back on the frontend, `mergePartialResultsIntoFullGraph` in `src/lib/graphUtils.ts` integrates the returned nodes into the complete client-side graph. It iterates over all nodes currently in the frontend graph:

- If a node is not present in the backend response, it is returned unchanged.
- If a node is present in the response, the function overlays the updated `data` fields onto the existing client-side node, sets `dirty` to `false`, and propagates any matching entry from the `errors` array into `error` and `extendedError`.
- If the node is a `script_verification` node and the response includes `scriptDebugSteps`, that payload is moved into the `scriptStepsCache` (via `setScriptSteps` from `src/lib/share/scriptStepsCache.ts`) and deleted from the node object. This prevents large debug traces from bloating the undo history or being sent back to the backend on the next request.

After building the merged array, `setNodes` is called. React re-renders the canvas with the new results.

### Step 9: Record an undo snapshot

Once the version number in `useGlobalCalculationLogic` confirms the response is not stale (by comparing `version` to `versionRef.current`), the status banner is updated to either `"OK"` or `"ERROR"`. The snapshot scheduler in `src/hooks/useSnapshotScheduler.ts` then pushes a clean entry into `UndoRedoContext`. This entry stores the updated node and edge state along with the calculation status. Pressing Ctrl+Z later restores the canvas to the state captured in this entry.

---

## How the Backend Resolves Inputs

Step 6 described execution at a high level. This section explains in detail how the backend turns a node's stored state and incoming wires into the exact parameters passed to each Python function.

`FUNCTION_SPECS` in `backend/calc_functions/function_specs.py` assigns every function a `paramExtraction` mode. This value tells `bulk_calculate_logic` which builder in `PARAM_BUILDERS` to select.

### `"none"`: no inputs

Used by `random_256`. The builder `build_none_params` returns an empty dict and the function is invoked with no arguments.

### `"single_val"`: one input value

Used by `hash160_hex`, `double_sha256_hex`, `encode_varint`, and most single-step transformation functions.

`build_single_val_params` resolves the input as follows:

1. If an incoming edge exists, the upstream node's `result` is used.
2. If no edge exists, `node["data"]["value"]` (the user-typed text) is used as a fallback.
3. If neither is present, a `ValueError` with the message `"Missing required input 'val'"` is raised.

There is also an unwired-output guard: if the node has outgoing edges but no incoming value and is not an `identity` or `op_code_select` node, the error `"Unwired input: node has outputs but no incoming value"` is raised. This prevents silently propagating an empty value downstream.

### `"multi_val"`: an ordered list of values

Used by `concat_all`, `schnorr_sign_bip340`, `script_verification`, and most template-style nodes that accept several named inputs.

`build_multi_val_params` calls `_multi_common`, which iterates over the visible field indices defined in `node["data"]["inputStructure"]`. For each index, it applies the following precedence:

1. Sentinel `__FORCE00__` in `node["data"]["inputs"]["vals"]`: overrides the value to `"00"`.
2. Sentinel `__EMPTY__`: forces the value to an empty string.
3. Sentinel `__NULL__`: passes `None` (used by `musig2_nonce_gen` for the optional extra randomness parameter).
4. An incoming edge at that index position (keyed by `targetHandle` such as `"handle-3"`): the upstream node's `result` is used.
5. A manually typed value in `node["data"]["inputs"]["vals"][index]`.

The resolved values are assembled into an ordered list in field-index order, so the Python function always receives inputs in the order the flow author defined.

### `"val_with_network"`: one input value plus a network selector

Used by address-derivation functions such as `hash160_to_p2pkh_address`, `hash160_to_p2wpkh_address`, and `p2tr_address_from_xonly`.

`build_val_with_network_params` resolves the main value using the same logic as `build_single_val_params`, then appends `selectedNetwork` from `node["data"]["selectedNetwork"]`. The valid values are `"mainnet"`, `"testnet"`, and `"regtest"`. If the field is absent, the builder defaults to `"regtest"`.

---

## A `POST /bulk_calculate` Request and Response Example

The following example shows the JSON exchanged for a two-node flow: an `identity` node holding a hex value wired into a `sha256_hex` node. The `sha256_hex` node is dirty because the upstream value just changed.

### Request

Both nodes are included in the payload even though only `node_hash` is dirty. The identity node is included because the backend needs its `result` to resolve the wired input when building `sha256_hex`'s parameters.

```json
{
  "nodes": [
    {
      "id": "node_src",
      "type": "calculation",
      "position": { "x": 100, "y": 150 },
      "data": {
        "functionName": "identity",
        "value": "68656c6c6f",
        "inputs": { "val": "68656c6c6f" },
        "result": "68656c6c6f",
        "dirty": false,
        "error": false
      }
    },
    {
      "id": "node_hash",
      "type": "calculation",
      "position": { "x": 350, "y": 150 },
      "data": {
        "functionName": "sha256_hex",
        "inputs": {},
        "dirty": true,
        "error": false
      }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_src",
      "target": "node_hash"
    }
  ],
  "version": 3
}
```

The frontend strips these fields from every node before sending: `extendedError`, `scriptDebugSteps`, `scriptSteps`, `taprootTree`, `banner`, `tooltip`, `comment`, `showComment`, `searchMark`, and `groupFlash`.

### Success response (HTTP 200)

The backend returns both nodes with updated `result` values and `dirty` cleared. On a successful run the `error` key is removed from the node's data entirely via `data.pop("error", None)`. It is not set to `false`.

```json
{
  "nodes": [
    {
      "id": "node_src",
      "type": "calculation",
      "data": {
        "functionName": "identity",
        "value": "68656c6c6f",
        "inputs": { "val": "68656c6c6f" },
        "result": "68656c6c6f",
        "dirty": false
      }
    },
    {
      "id": "node_hash",
      "type": "calculation",
      "data": {
        "functionName": "sha256_hex",
        "inputs": { "val": "68656c6c6f" },
        "result": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        "dirty": false
      }
    }
  ],
  "version": 3
}
```

The `result` value above is the SHA-256 hash of the bytes represented by `68656c6c6f` (the ASCII string "hello" in hex), confirmed by running `hashlib.sha256(bytes.fromhex("68656c6c6f")).hexdigest()`.

### Error response (HTTP 400)

If `node_hash` had no upstream wire and no `data.value`, the response would be:

```json
{
  "nodes": [
    { "id": "node_src", "data": { "result": "68656c6c6f", "dirty": false } },
    {
      "id": "node_hash",
      "data": {
        "functionName": "sha256_hex",
        "error": true,
        "extendedError": "Calculation failed: Missing required input 'val'",
        "dirty": false
      }
    }
  ],
  "errors": [
    { "nodeId": "node_hash", "error": "Missing required input 'val'" }
  ],
  "version": 3
}
```

The `nodes` array is still present in error responses. The frontend uses it to highlight the failing node on the canvas.

---

## A Concrete Example: P2PKH Address Derivation

The following example walks through what happens when a user builds a Pay-to-Public-Key-Hash (P2PKH) address derivation flow and edits the private key node.

The flow connects five nodes in sequence:

![P2PKH_Address_Derivation_Nodes](./P2PKH_Address_Derivation_Nodes.JPG)

When the user types a new private key into the first `identity` node:

1. `useNodeCalculationLogic` sets `dirty: true` on that node and clears its `error` flag.
2. The 500 ms debounce begins. No network call happens yet.
3. `getAffectedSubgraph` is called. The private key node is dirty. All four downstream nodes are reachable via forward BFS, so all five nodes and their connecting edges enter the subgraph.
4. `checkForCyclesAndMarkErrors` runs on the subgraph and finds no cycles.
5. `stripNodeForBackend` removes UI-only fields from each node. The stripped payload is sent to `POST /bulk_calculate` with `version: N`.
6. The backend runs `topological_sort` and gets the evaluation order: `identity (privkey) -> public_key_from_private_key -> hash160_hex -> hash160_to_p2pkh_address -> identity (address)`.
7. The backend calls each function in turn:
   - `identity(val="<privkey hex>")` returns the private key unchanged and writes it to `result`.
   - `public_key_from_private_key(val="<privkey hex>")` derives the SEC-encoded compressed public key and writes it to `result`.
   - `hash160_hex(val="<pubkey hex>")` computes RIPEMD-160(SHA-256(pubkey bytes)) and writes the 20-byte hash to `result`.
   - `hash160_to_p2pkh_address(val="<hash160 hex>", selectedNetwork="testnet")` encodes the hash with a version byte and Base58Check and writes the address string to `result`.
   - The final `identity` node passes the address through unchanged.
8. The backend returns all five nodes with updated `result` fields, HTTP 200.
9. `mergePartialResultsIntoFullGraph` overlays the new data onto the full client-side graph. All five nodes now show their fresh values.
10. `UndoRedoContext` records a snapshot so the user can undo back to the previous private key.

---

## Nodes With Multiple Output Handles

Most nodes expose a single output: the `result` field. A few functions return structured JSON that the backend unpacks into additional named output values stored in `data["outputValues"]`.

### `taproot_tweak_xonly_pubkey`

The function returns a JSON object. The backend writes:
- `output_xonly_pubkey` to `data["result"]`, accessible via output handle `output-0`.
- The parity byte (`"c0"` or `"c1"`) to `data["outputValues"]["output-1"]`.
- The tweak value, if present, to `data["outputValues"]["output-2"]`.

### `taproot_tree_builder`

The function returns a JSON object describing the full Taproot script tree. The backend writes:
- The Merkle root to `data["result"]`.
- The full tree structure to `data["taprootTree"]`, which the tree inspector panel reads.
- The selected leaf's Merkle path (determined by `data["taprootLeafIndex"]`) to `data["outputValues"]["output-1"]`.

### `musig2_nonce_gen`

The function returns a JSON object containing a public nonce and a secret nonce. The backend writes:
- The public nonce (`pubnonce`) to `data["result"]`.
- The secret nonce (`secnonce`) to `data["outputValues"]["output-1"]`.

On the frontend these extra handles are declared via `outputPorts` in the node definition and wired normally through React Flow.

---

## Script Verification: a Special Case

The `script_verification` node runs the Bitcoin Script debugger. Its Python function returns a JSON blob containing `isValid` and a `steps` array with one entry per opcode. Each step records the opcode name, the stack state before and after execution, and which script phase was active.

The backend writes this blob to `data["scriptDebugSteps"]` and sets `data["result"]` to `"true"` or `"false"` based on `isValid`. The frontend then moves the debug steps into a side-cache by calling `setScriptSteps(nodeId, steps)` from `src/lib/share/scriptStepsCache.ts` and deletes `scriptDebugSteps` from the node's data field:

```ts
// src/lib/graphUtils.ts, mergePartialResultsIntoFullGraph
if (freshSteps !== undefined) {
  setScriptSteps(old.id, freshSteps);   // write to side-cache
  delete merged.data.scriptDebugSteps;  // remove from node tree
}
```

Storing the debug steps separately prevents them from inflating undo history snapshots or being included in the next `POST /bulk_calculate` payload.

---

## Where Things are in the Codebase

| Concern                               | File and symbol                                                             |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Marking nodes dirty on user input     | `src/hooks/useCalculation.ts`, `useNodeCalculationLogic`                    |
| Debounce, subgraph selection, request | `src/hooks/useCalculation.ts`, `useGlobalCalculationLogic`                  |
| Subgraph algorithm                    | `src/lib/graphUtils.ts`, `getAffectedSubgraph`                              |
| Frontend cycle detection              | `src/lib/graphUtils.ts`, `checkForCyclesAndMarkErrors`                      |
| HTTP call to backend                  | `src/lib/graphUtils.ts`, `recalculateGraph`                                 |
| Merging results back                  | `src/lib/graphUtils.ts`, `mergePartialResultsIntoFullGraph`                 |
| Flask routes including `POST /bulk_calculate` | `backend/routes.py`                                                 |
| Main graph evaluation loop            | `backend/graph_logic.py`, `bulk_calculate_logic`                            |
| Python calculation functions          | `backend/calc_functions/calc_func.py`                                       |
| Param extraction specs                | `backend/calc_functions/function_specs.py`                                  |
| Node data TypeScript interface        | `src/types/flow.ts`, `CalculationNodeData`                                  |
| Non-calculable node list              | `src/lib/flow/nonCalculableNodes.ts`                                        |
| Script debug step cache               | `src/lib/share/scriptStepsCache.ts`                                         |

---

## Adding a New Calculation Node

The following changes are the minimum required to make a new function available on the canvas.

### 1. Write the Python function

Add the implementation to `backend/calc_functions/calc_func.py`:

```python
def my_new_function(val: str) -> str:
    # perform the calculation
    return result_hex
```

### 2. Register the spec in `function_specs.py`

Add an entry to `FUNCTION_SPECS` in `backend/calc_functions/function_specs.py`:

```python
"my_new_function": {
    "paramExtraction": "single_val",
    "params": {
        "val": {"type": "string", "required": True}
    }
},
```

### 3. Register the callable in `graph_logic.py`

Import the function and add it to `CALC_FUNCTIONS` in `backend/graph_logic.py`:

```python
from calc_functions.calc_func import my_new_function

CALC_FUNCTIONS = {
    # existing entries ...
    "my_new_function": my_new_function,
}
```

### 4. Create the node definition on the frontend

Add an entry to `src/components/sidebar-nodes.ts` (or `src/components/initial-nodes.ts` for flow defaults). Set `functionName: "my_new_function"` in the `data` block and define `inputStructure` to describe which fields the backend reads when building the parameter list.

### 5. Write a test

Add a test to `backend/tests/test_calc_func.py` or `backend/tests/test_graph_logic.py` that covers the happy path and at least one error case. Run `python3 run_all_tests.py` to verify the full test suite stays green.

---

## Common Failure Cases

### Missing required input on a `single_val` node

A `single_val` node expects exactly one input: either an upstream wire or a `data.value` typed by the user. If neither is present and the node has outgoing wires, `build_single_val_params` in `backend/graph_logic.py` raises `ValueError("Missing required input 'val'")`. The outer exception handler in `bulk_calculate_logic` catches this and writes:

```python
data["error"]         = True
data["extendedError"] = "Calculation failed: Missing required input 'val'"
data["dirty"]         = False
```

The error entry `{ "nodeId": "...", "error": "Missing required input 'val'" }` is appended to the errors list and the response is HTTP 400.

A related guard fires when a `single_val` node has outgoing wires but no incoming value and is not an `identity` or `op_code_select` node. In that case the error message is `"Unwired input: node has outputs but no incoming value"`.

### Type validation failure

If `FUNCTION_SPECS` declares `"type": "integer"` for a parameter (for example, `uint32_to_little_endian_4_bytes`) and the user provides a non-integer string, `validate_inputs` raises a `ValueError` before the callable is invoked. The node receives `extendedError: "Calculation failed: Param 'val' must be an integer"` and the response is HTTP 400.

### Unknown `functionName`

If `node["data"]["functionName"]` does not match any key in `CALC_FUNCTIONS`, the backend marks the node without entering the execution path at all:

```python
data["error"]         = True
data["extendedError"] = "No such function 'my_typo'"
data["dirty"]         = False
```

This can happen when a flow JSON has been hand-edited or when a function was renamed without updating saved flows.

### A node error does not block its downstream nodes

When a node raises an exception during execution, the backend writes `error: True` but does not clear `data["result"]`. Downstream nodes continue to run using whatever `result` value was left from the previous successful run. If there was no previous result, `get_res` returns `None` and the downstream node will likely fail with `"Missing required input"`. If there was a previous result, the downstream node may succeed using stale data while the upstream node shows an error on the canvas.

### Stale response discarded by the frontend

Each call to `recalculateGraph` in `src/lib/graphUtils.ts` increments `versionRef.current` and includes the new value in the request body. The backend echoes it back unchanged. When the response arrives, `useGlobalCalculationLogic` compares `json.version` to `versionRef.current`. If a newer request was sent while the first was in-flight, the version numbers will not match and the response is silently discarded. The canvas waits for the latest response without showing an error.

### Cycle in the graph

`checkForCyclesAndMarkErrors` in `src/lib/graphUtils.ts` runs Kahn's algorithm on the subgraph before any network call. If a cycle is detected, every node in the subgraph receives `error: true` and `extendedError: "Cycle detected in this sub-graph – calculation aborted."` and no request is sent.

The backend also detects cycles via `_mark_cycle_errors` in `backend/graph_logic.py` as a secondary check. In practice the frontend check fires first.

### Per-request and per-IP execution timeouts

The backend enforces two independent limits. The first is `CALCULATION_TIMEOUT_SECONDS` in `backend/config.py`, a per-request wall-clock budget. If evaluation exceeds it, `CalculationTimeoutError` is raised and all remaining dirty nodes receive:

```python
data["error"]         = True
data["extendedError"] = "Flow evaluation exceeded the execution budget of 10.0 seconds"
data["dirty"]         = False
```

The second is a per-IP sliding-window budget tracked in `backend/computation_budget.py`. If a client has consumed too much server time within the configured window, `POST /bulk_calculate` returns HTTP 429 immediately and no evaluation runs.

---

