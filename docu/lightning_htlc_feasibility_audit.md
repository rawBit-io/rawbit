# Lightning HTLC Lesson Feasibility Audit

## Verdict

Building a complete lesson for `fund P2WSH HTLC -> spend via preimage` is feasible in rawBit with the current codebase, but not as a drop-in extension of the existing Lightning flow.

- The backend already has the core primitives for:
  - hashing and P2WSH address derivation
  - generic script assembly
  - transaction field extraction
  - witness-aware script verification
- The current Lightning flow is still lightweight and conceptual. It does not yet build a funding transaction, derive a P2WSH output, assemble a real witness, or verify/broadcast a full spend.
- There is no in-app testnet broadcaster. Current flows only tell the learner to use external tools like `bitcoin-cli -testnet sendrawtransaction`.

## 1. Relevant `calc_func.py` functions

### P2WSH address construction

Public node-level functions:

| Function | Why it matters | Ref |
|---|---|---|
| `sha256_hex(val: str) -> str` | Hashes a full witness script into the 32-byte program needed for P2WSH. | `backend/calc_functions/calc_func.py:2219` |
| `sha256_to_p2wsh_address(val: str, selectedNetwork: str = "regtest") -> str` | Converts the 32-byte SHA256 into a bech32 v0 P2WSH address. | `backend/calc_functions/calc_func.py:2867` |
| `address_to_scriptpubkey(val: str) -> str` | Converts the resulting `tb1...` / `bc1...` address back into `0020{sha256}` for tx outputs and verification. | `backend/calc_functions/calc_func.py:2899` |

Supporting internals:

| Function | Why it matters | Ref |
|---|---|---|
| `_bech32_encode(hrp, witver, prog)` | Low-level bech32 encoder used by P2WSH address generation. | `backend/calc_functions/calc_func.py:153` |
| `_bech32_decode(addr)` | Lets the app reverse addresses back into witness `scriptPubKey`s. | `backend/calc_functions/calc_func.py:167` |
| `_hrp_for_network(selectedNetwork)` | Picks `tb`, `bc`, or `bcrt` for bech32 output. | `backend/calc_functions/calc_func.py:197` |

### HTLC script assembly

| Function | Why it matters | Ref |
|---|---|---|
| `concat_all(vals: list) -> str` | Main generic assembler used by flows to concatenate script parts, tx parts, and witness parts. | `backend/calc_functions/calc_func.py:1630` |
| `op_code_select(val: str) -> str` | Pass-through for preselected opcode hex fragments. | `backend/calc_functions/calc_func.py:2246` |
| `encode_script_push_data(val: str) -> str` | Produces the correct push opcode for preimage, pubkey, hash, or witness-script data. | `backend/calc_functions/calc_func.py:2229` |
| `int_to_script_bytes(val)` | Encodes CLTV/CSV integers into minimal script-number bytes. | `backend/calc_functions/calc_func.py:2273` |
| `sha256_hex(val: str) -> str` | Needed for SHA256 payment-hash style HTLCs. | `backend/calc_functions/calc_func.py:2219` |
| `hash160_hex(val: str) -> str` | Present, but more suitable for older hashlock patterns than Lightning-style SHA256 HTLCs. | `backend/calc_functions/calc_func.py:1840` |
| `blocks_to_sequence_number(val: int) -> int` | Helper for CSV-style delays in block units. | `backend/calc_functions/calc_func.py:2312` |
| `hours_to_sequence_number(val)` | Helper for CSV-style delays in time units. | `backend/calc_functions/calc_func.py:2440` |
| `encode_sequence_block_flag(val)` | Encodes BIP68 block-based sequence values. | `backend/calc_functions/calc_func.py:2470` |
| `encode_sequence_time_flag(val)` | Encodes BIP68 time-based sequence values. | `backend/calc_functions/calc_func.py:2500` |

### Transaction field extraction

| Function | Why it matters | Ref |
|---|---|---|
| `extract_tx_field(vals: list[str]) -> str` | Reads `txid`, counts, per-input fields, per-output fields, and `raw_no_witness` from raw tx hex. | `backend/calc_functions/calc_func.py:2658` |
| `_deserialize_tx_cached(raw_hex: str)` | Internal parser/cache behind `extract_tx_field` and verification. | `backend/calc_functions/calc_func.py:251` |

Supported `extract_tx_field` outputs are:

- top-level: `version`, `locktime`, `input_count`, `output_count`, `txid`
- vin: `vin.txid`, `vin.vout`, `vin.scriptSig`, `vin.sequence`
- vout: `vout.value`, `vout.scriptPubKey`
- extra: `raw_no_witness`

Notably absent: witness-stack extraction and `wtxid`.

### Witness construction

There is no dedicated backend function whose only job is "build a witness."

Current witness construction is done with generic helpers:

| Function | Why it matters | Ref |
|---|---|---|
| `concat_all(vals: list)` | Used as the actual witness serializer in flows/templates. | `backend/calc_functions/calc_func.py:1630` |
| `encode_varint(val)` | Used to encode item counts and item lengths. | `backend/calc_functions/calc_func.py:1715` |
| `varint_encoded_byte_length(val)` | Useful for deriving script/witness lengths from hex. | `backend/calc_functions/calc_func.py:1850` |

The UI already exposes this pattern as a reusable template node:

- `P2WSH Witness`: `src/components/sidebar-nodes.ts:743`
- `SCRIPTCODE Builder`: `src/components/sidebar-nodes.ts:2921`

### Script verification

| Function | Why it matters | Ref |
|---|---|---|
| `script_verification(vals: list) -> str` | Central verifier. Handles witness-aware validation, exposes trace steps, surfaces `witnessScript`, and requires spent amount for SegWit/Taproot. | `backend/calc_functions/calc_func.py:1901` |
| `_build_taproot_prevouts(...)` | Taproot-specific helper used by the verifier for multi-input prevout context. | `backend/calc_functions/calc_func.py:1865` |

Evidence that witness verification already works for P2WSH:

- `test_script_verification_p2wsh_op_true_succeeds`: `backend/tests/test_calc_func.py:1018`

## 2. `function_specs.py` signatures

The public, spec-declared signatures relevant to this lesson are:

| Function | Signature shape in specs | Ref |
|---|---|---|
| `concat_all` | `multi_val`, `vals: any` | `backend/calc_functions/function_specs.py:11` |
| `sha256_hex` | `single_val`, `val: string` | `backend/calc_functions/function_specs.py:198` |
| `script_verification` | `multi_val`, `vals: any` | `backend/calc_functions/function_specs.py:226` |
| `op_code_select` | `single_val`, `val: string` | `backend/calc_functions/function_specs.py:232` |
| `encode_script_push_data` | `single_val`, `val: string` | `backend/calc_functions/function_specs.py:239` |
| `int_to_script_bytes` | `single_val`, `val: integer` | `backend/calc_functions/function_specs.py:245` |
| `blocks_to_sequence_number` | `single_val`, `val: integer` | `backend/calc_functions/function_specs.py:257` |
| `hours_to_sequence_number` | `single_val`, `val: number` | `backend/calc_functions/function_specs.py:263` |
| `encode_sequence_block_flag` | `single_val`, `val: integer` | `backend/calc_functions/function_specs.py:295` |
| `encode_sequence_time_flag` | `single_val`, `val: integer` | `backend/calc_functions/function_specs.py:301` |
| `extract_tx_field` | `multi_val`, `vals: any` | `backend/calc_functions/function_specs.py:314` |
| `sha256_to_p2wsh_address` | `val_with_network`, `val: string`, `selectedNetwork?: string` | `backend/calc_functions/function_specs.py:350` |
| `address_to_scriptpubkey` | `single_val`, `val: string` | `backend/calc_functions/function_specs.py:365` |

There is no spec-declared dedicated function for:

- BIP143 preimage assembly
- BIP143 sighash calculation
- witness-stack extraction from a raw tx
- witness serialization as a first-class calculator
- testnet broadcast

## 3. `p6_Spilman_channel.json` structure

### How `TX Field Extract` nodes are used

The Spilman flow uses `extract_tx_field` as a repeated verification scaffold, not as the initial data-entry mechanism.

Observed `TX Field Extract` clusters:

- `src/my_tx_flows/p6_Spilman_channel.json:5079`
- `src/my_tx_flows/p6_Spilman_channel.json:5249`
- `src/my_tx_flows/p6_Spilman_channel.json:5423`
- `src/my_tx_flows/p6_Spilman_channel.json:5609`
- `src/my_tx_flows/p6_Spilman_channel.json:5875`
- `src/my_tx_flows/p6_Spilman_channel.json:5989`
- `src/my_tx_flows/p6_Spilman_channel.json:6111`
- `src/my_tx_flows/p6_Spilman_channel.json:6333`
- `src/my_tx_flows/p6_Spilman_channel.json:6398`
- `src/my_tx_flows/p6_Spilman_channel.json:6520`

Pattern:

- a fully assembled raw transaction hex is wired into `extract_tx_field`
- the node is configured to read one specific field such as:
  - `txid`
  - `vin.txid`
  - `vin.vout`
  - `vin.scriptSig`
  - `vin.sequence`
  - `vout.value`
  - `vout.scriptPubKey`
  - `raw_no_witness`
- extracted values are then compared against expected values with `compare_equal` or used to explain correctness

So in practice, these nodes are used to inspect and prove properties of already-built transactions.

### Pattern for real UTXO input

The Spilman flow starts with manual UTXO entry, not live lookup.

Relevant nodes:

- `Previous TXID (from faucet)`: `src/my_tx_flows/p6_Spilman_channel.json:182`
- comment `Prev TXID -> faucet or explorer`: `src/my_tx_flows/p6_Spilman_channel.json:184`
- `Output Index (vout)`: `src/my_tx_flows/p6_Spilman_channel.json:219`
- `Previous ScriptPubKey (placeholder)`: `src/my_tx_flows/p6_Spilman_channel.json:324`
- comment `ScriptPubKey -> paste from explorer or derive`: `src/my_tx_flows/p6_Spilman_channel.json:325`
- `Funding TX (placeholder scriptSig)`: `src/my_tx_flows/p6_Spilman_channel.json:654`

Interpretation:

- the learner manually pastes real UTXO details from a faucet or explorer
- the funding transaction is assembled directly from those values
- only after transactions exist does the flow switch into `extract_tx_field`-based introspection

This is likely the reusable pattern for a real HTLC lesson too:

1. manual funded UTXO entry
2. funding tx assembly
3. spend tx assembly
4. extract-and-compare verification nodes

## 4. Testnet broadcast functionality

I did not find any in-app broadcaster.

What exists:

- many lesson comments/instructions say to use external broadcast tools such as `bitcoin-cli -testnet sendrawtransaction <hex>`
  - example in Spilman: `src/my_tx_flows/p6_Spilman_channel.json:807`
  - many more in `p1`, `p4`, `p9`, etc.
- the README explicitly says rawBit is not a broadcaster:
  - `README.md:74`
  - `README.md:76`

What I did not find:

- no backend route for broadcasting raw tx hex
- no frontend fetch to blockchain broadcast APIs like Blockstream, mempool, or Esplora
- no wallet/UTXO sync surface

Conclusion:

- broadcast is currently external/manual
- local verification is supported
- live testnet execution inside the app would require new integration work

## 5. Gap analysis: what is still missing for a complete P2WSH HTLC lesson

## Already present

The codebase is closer than it might look:

- Lesson 9 already covers P2WPKH -> P2WSH funding and later P2WSH spending patterns:
  - `src/my_tx_flows/p9_SegWit_P2WSH.json:7864`
  - `src/my_tx_flows/p9_SegWit_P2WSH.json:7880`
  - `src/my_tx_flows/p9_SegWit_P2WSH.json:7896`
- The sidebar already exposes reusable P2WSH witness/scriptCode templates:
  - `src/components/sidebar-nodes.ts:743`
  - `src/components/sidebar-nodes.ts:2921`
- `script_verification` already supports witness-aware verification and is tested on P2WSH.

So a full lesson is feasible mostly as flow-authoring work, not a protocol-engine rewrite.

## Biggest current gap

`p15_Lightning_HTLC.json` is not a complete transaction lesson yet.

It currently contains only a conceptual HTLC assembly path:

- `hash160_hex` for the secret: `src/my_tx_flows/p15_Lightning_HTLC.json:249`
- `int_to_script_bytes` for the timeout: `src/my_tx_flows/p15_Lightning_HTLC.json:298`
- `concat_all` script assembly nodes: `src/my_tx_flows/p15_Lightning_HTLC.json:323`, `:385`, `:447`

What it does not yet include:

- P2WSH funding tx construction
- P2WSH address derivation
- BIP143 preimage construction for the success spend
- ECDSA signing of the success spend
- witness construction for the success branch
- witness/script verification of the success branch
- tx field extraction on the finished spend

Also, the current Lightning flow uses `hash160_hex`, while a Lightning-style HTLC is typically taught with a SHA256 payment hash. For a true Lightning-focused lesson, `sha256_hex` should replace that part.

## Recommended new functions

Strictly speaking, no new backend function is absolutely required to make a working lesson, because generic nodes can already compose most of it.

That said, these additions would make the lesson much cleaner and less error-prone:

1. `segwit_v0_sighash_preimage(...)`
   - Purpose: build the full BIP143 preimage from structured tx fields.
   - Why: current flows appear to build BIP143 manually via generic concatenation.

2. `segwit_v0_sighash(...)`
   - Purpose: return the final double-SHA256 digest for signing.
   - Why: reduces repeated "concat -> dSHA256" wiring and makes the lesson easier to audit.

3. `build_witness_stack(items[])`
   - Purpose: serialize witness item count + per-item varint lengths + bytes.
   - Why: current witness building is possible, but it is done through generic `concat_all` and manual varint bookkeeping.

4. `extract_tx_witness_field(rawTx, inputIndex, field)`
   - Purpose: expose witness item count, witness items, or full witness for a given vin.
   - Why: `extract_tx_field` currently cannot inspect witness data, which is important in a P2WSH HTLC lesson.

5. `extract_tx_ids(rawTx)` or extend `extract_tx_field` with `wtxid`
   - Purpose: expose both `txid` and `wtxid`.
   - Why: Lightning education benefits from showing why SegWit fixed malleability.

6. `broadcast_testnet_tx(rawTx)` if live execution is a product goal
   - Purpose: optional external integration.
   - Why: today the app stops at assembly/verification and offloads broadcast to `bitcoin-cli` or third-party tools.

## Bottom line

If the goal is:

- `build a teachable local lesson with verification`: feasible now, mostly by extending Lesson 9 patterns and upgrading `p15`
- `make the lesson pleasant to author and inspect`: add BIP143 and witness helper functions
- `broadcast directly from rawBit`: not supported today; requires new product/integration work
