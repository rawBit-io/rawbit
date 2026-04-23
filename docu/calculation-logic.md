# How Frontend Nodes and Backend Calculation Logic Fit Together

This guide traces the complete path from a user editing a canvas node to a recalculated result appearing on screen.

Before reading this guide, browse at least one rawBit lesson to get a concrete picture of how nodes and wires look on the canvas. Setup instructions are in the [Quick start section of the README](../README.md).

## What Is a Calculation Node?

Two node types exist purely for structure and never participate in calculations. These are `shadcnGroup` which groups nodes visually and `shadcnTextInfo` which shows a text annotation. 

Every other node on the canvas has `type: "calculation"`. Its `data` field is a `CalculationNodeData` object and forms the contract between the frontend and the backend.

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

| Field | Written by | Purpose |
| --- | --- | --- |
| `functionName` | Flow JSON  | Names the entry in `CALC_FUNCTIONS` the backend calls |
| `dirty` | Frontend on user edit | Signals that the node's output is stale |
| `value` | User typing in the node's input field | Fallback input when no upstream wire is connected |
| `inputs` | Backend after each successful run | Resolved parameters used in the last execution |
| `inputStructure` | Flow JSON  | Describes visible input fields and their indices |
| `result` | Backend after each successful run | The function's return value |
| `error` | Backend on failure | Marks whether the last execution failed  |
| `extendedError` | Backend  | Human-readable error shown in the node inspector |



## The Calculation Lifecycle

The following nine steps trace the full path from a user interaction to a recalculated canvas.

**1. The user changes an input.** 

When the user types in a node's field or connects a wire, `useCalcNodeMutations` in `src/hooks/nodes/useCalcNodeMutations.ts` updates `data.inputs.vals`, sets `data.dirty` to `true`, and clears `data.error`. Downstream nodes are not marked dirty here.

**2. The calculation hook detects the dirty flag and starts a debounce.** 

`useGlobalCalculationLogic` in `src/hooks/useCalculation.ts` scans the node list after every render. When it finds at least one dirty `calculation` node, it calls `onStatusChange("CALC")` to update the status banner and starts a 500 ms debounce timer. Rapid edits reset the timer rather than dispatching one request per keystroke.

**3. Compute the affected subgraph.** 

When the debounce elapses, `getAffectedSubgraph` in `src/lib/graphUtils.ts` computes the minimal set of nodes and edges the backend needs. Starting from dirty nodes, it runs a backward breadth-first search to collect all ancestors (whose results are needed as inputs) and a forward search to collect all descendants (whose outputs depend on the new result). If a `concat_all` node appears in the affected set, every node feeding into it is added to the seed set and both searches run again. This is because `concat_all` requires its full ordered input list on every run.

**4. Check for cycles before sending.** 

`checkForCyclesAndMarkErrors` in `src/lib/graphUtils.ts` runs Kahn's topological-sort algorithm on the subgraph. If the algorithm processes fewer nodes than the subgraph contains, a cycle exists. Every node in the subgraph receives `error: true` and `extendedError: "Cycle detected in this sub-graph – calculation aborted."`. The backend is never called.

**5. Strip UI-only fields and send the request.**

 `recalculateGraph` in `src/lib/graphUtils.ts` passes each node through `stripNodeForBackend`, which removes fields irrelevant to the backend. It then checks the serialised payload against `maxPayloadBytes` from `GET /healthz`. If the payload is too large, all dirty nodes receive a size-limit error and no request is sent. Otherwise the request goes to `POST /bulk_calculate` with the body `{ "nodes": [...], "edges": [...], "version": N }`, where `N` is incremented on every call via `++versionRef.current`. A 5-second `AbortController` timeout is applied to the fetch call.

**6. The backend sorts nodes and executes each one.** 

The `POST /bulk_calculate` route in `backend/routes.py` checks the per-IP sliding-window budget via `computation_budget.py` before calling `bulk_calculate_logic` in `backend/graph_logic.py`. If the budget is exhausted it returns HTTP 429 immediately. Inside `bulk_calculate_logic`, edges referencing unknown node IDs are dropped, then Kahn's algorithm determines evaluation order. For each node in topological order, the backend looks up the Python callable in `CALC_FUNCTIONS`, selects a parameter builder from `PARAM_BUILDERS` based on the `paramExtraction` mode in `FUNCTION_SPECS`, resolves the inputs, validates them with `validate_inputs` and calls the function. 

On success, `data["result"]` is written and `data.pop("error", None)` removes any prior error. The entire loop runs within the wall-clock budget set by `CALCULATION_TIMEOUT_SECONDS` in `backend/config.py`.

**7. The backend returns its response.** 

When all nodes succeed, the route returns HTTP 200 with `{ "nodes": [...], "version": N }`. When at least one node fails, it returns HTTP 400 with `{ "nodes": [...], "version": N, "errors": [...] }`. The `nodes` array is present in both cases so the frontend can render the correct state.

**8. Merge results into the full graph.** 

`mergePartialResultsIntoFullGraph` in `src/lib/graphUtils.ts` iterates over every node in the full client-side graph. Nodes absent from the response are returned unchanged. Nodes present in the response have their `data` fields overlaid with the returned values and `dirty` set to `false`. Any matching entry in the `errors` array is written into `error` and `extendedError`. `script_verification` debug steps are moved into `scriptStepsCache` (via `src/lib/share/scriptStepsCache.ts`) and deleted from the node object to keep them out of undo history and future payloads.

**9. Version check and undo snapshot.** 

`useGlobalCalculationLogic` compares the response `version` to `versionRef.current`. If a newer request was sent while the first was in-flight, the version numbers will not match and the response is silently discarded. If the versions match, `onStatusChange` updates the status banner to `"OK"` or `"ERROR"` and `UndoRedoContext` records a snapshot for Ctrl+Z.

## How the Backend Resolves Inputs

`FUNCTION_SPECS` in `backend/calc_functions/function_specs.py` assigns every function a `paramExtraction` mode. This selects the builder the backend uses from `PARAM_BUILDERS` in `backend/graph_logic.py`.

## Example: P2PKH Address Derivation

A Pay-to-Public-Key-Hash (P2PKH) address derivation flow connects five nodes in sequence:

![P2PKH_Address_Derivation_Nodes](./P2PKH_Address_Derivation_Nodes.JPG)

When the user types a new private key into the first `identity` node:

1. `useCalcNodeMutations` sets `dirty: true` on the identity node and clears its `error` flag.
2. The 500 ms debounce starts. No network call happens yet.
3. `getAffectedSubgraph` starts from the dirty identity node, finds no ancestors, and walks forward through all four downstream nodes. All five nodes and their edges enter the subgraph.
4. `checkForCyclesAndMarkErrors` finds no cycles.
5. `stripNodeForBackend` removes UI-only fields. The payload is sent to `POST /bulk_calculate` with `version: N`.
6. The backend runs `topological_sort` and gets the evaluation order: `identity (privkey)`, `public_key_from_private_key`, `hash160_hex`, `hash160_to_p2pkh_address`, `identity (address)`.
7. The backend calls each function in order:
   - `identity(val="<privkey hex>")` returns the private key unchanged.
   - `public_key_from_private_key(val="<privkey hex>")` derives the SEC-encoded compressed public key.
   - `hash160_hex(val="<pubkey hex>")` computes RIPEMD-160(SHA-256(pubkey bytes)) and returns the 20-byte hash.
   - `hash160_to_p2pkh_address(val="<hash160 hex>", selectedNetwork="testnet")` encodes the hash with a version byte and Base58Check and returns the address string.
   - The final `identity` node passes the address through unchanged.
8. The backend returns all five nodes with updated `result` fields, HTTP 200.
9. `mergePartialResultsIntoFullGraph` overlays the new data onto the full client-side graph. All five nodes show fresh values.
10. `UndoRedoContext` records a snapshot so the user can undo back to the previous private key.



## Example: `POST /bulk_calculate` Request and Response 

The following example shows the JSON exchanged for a two-node flow, an `identity` node holding a hex value wired into a `sha256_hex` node. The `sha256_hex` node is dirty because the upstream value just changed.

Both nodes are included in the payload even though only `node_hash` is dirty. The backend needs the identity node's `result` to resolve the wired input.

### Request

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

The `version` integer is echoed back by the backend and used by the frontend to discard out-of-order responses. `stripNodeForBackend` removes `extendedError`, `scriptDebugSteps`, `scriptSteps`, `taprootTree`, `banner`, `tooltip`, `comment`, `showComment`, `searchMark` and `groupFlash` before the request is sent.

### Success response (HTTP 200)

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

On a successful run the `error` key is removed from `data` entirely. It is not set to `false`.

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

The `nodes` array is present in error responses. The frontend uses it to highlight the failing node on the canvas.


## Common Failure Cases

**1. Missing required input.** 

A `single_val` node with no upstream wire and no `data.value` produces `extendedError: "Calculation failed: Missing required input 'val'"` (HTTP 400). A wired-output node with no incoming value produces `"Unwired input: node has outputs but no incoming value"` instead.

**2. Node error does not block downstream nodes.** 

When a node fails, the backend sets `error: true` but keeps the previous `data["result"]` in place. Downstream nodes run against that stale value. If no prior result exists they will fail with their own missing-input error.

**3. Stale response discarded.** 

The frontend increments `versionRef.current` on every request and the backend echoes it back. If a newer request was sent while the first was in-flight, the version numbers will not match and the earlier response is silently dropped.

**4. Cycle detected.** 

`checkForCyclesAndMarkErrors` in `src/lib/graphUtils.ts` runs before any network call. A detected cycle marks every node in the subgraph with `extendedError: "Cycle detected in this sub-graph – calculation aborted."` and sends no request.

**5. Execution timeouts.** 

A per-request wall-clock budget (`CALCULATION_TIMEOUT_SECONDS` in `backend/config.py`) marks all remaining dirty nodes with a timeout error and returns partial results. A separate per-IP sliding-window budget (`computation_budget.py`) returns HTTP 429 immediately if the client has consumed too much server time within the window.
