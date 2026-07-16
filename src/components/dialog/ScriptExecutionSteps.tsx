/* ---------------------------------------------------------------
 *  ScriptExecutionSteps.tsx  –  multi-phase trace viewer
 * --------------------------------------------------------------- */

import {
  Component,
  useState,
  useEffect,
  useCallback,
  KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ScriptExecutionStepsProps,
  RenderHighlightedScriptProps,
  StepData,
} from "@/types";
import { OP_CODES, OpCodeCategories } from "@/lib/opcodes";
import {
  SENTINEL_EMPTY,
  SENTINEL_FORCE00,
  SENTINEL_NULL,
} from "@/lib/nodes/constants";

/* ---------- helpers ------------------------------------------------ */

const phaseTextFor = (phase: string, execScriptLabel = "scriptCode") => {
  switch (phase) {
    case "scriptSig":
      return "Phase 1 (scriptSig)";
    case "scriptPubKey":
      return "Phase 2 (scriptPubKey)";
    case "redeemScript":
      return "Phase 3 (redeemScript)";
    case "witness":
      return "Witness validation (BIP141)";
    case "taproot":
      return "Phase 4 (taproot)";
    default:
      return `Phase 4 (${execScriptLabel})`;
  }
};

/** Node inputs may carry checkbox sentinels; map them to effective hex. */
const effectiveScriptHex = (value = "") =>
  value === SENTINEL_EMPTY || value === SENTINEL_NULL
    ? ""
    : value === SENTINEL_FORCE00
      ? "00"
      : value;

/** Bitcoin VarInt (compact size) encoding as lowercase hex. */
const varIntHex = (n: number): string => {
  const le = (val: number, byteCount: number) =>
    Array.from({ length: byteCount }, (_, i) =>
      ((val >>> (8 * i)) & 0xff).toString(16).padStart(2, "0"),
    ).join("");
  if (n <= 0xfc) return le(n, 1);
  if (n <= 0xffff) return `fd${le(n, 2)}`;
  return `fe${le(n, 4)}`;
};

/**
 * Validator steps are consensus rules applied by the validation engine,
 * not opcodes. New traces mark them with kind="validator"; older cached
 * traces only have pseudo-steps at pc -1, and some older validator events
 * carry neither pc nor kind — a step without any program counter or opcode
 * cannot be an engine instruction, so it is classified as a rule too.
 */
const isValidatorStep = (step: StepData) =>
  step.kind === "validator" ||
  (step.pc ?? 0) < 0 ||
  (step.pc === undefined && step.opcode === undefined);

/**
 * Pure witness bookkeeping that the walker does not dedicate steps to: the
 * v0 program-pattern match and the per-item deserialization. These are pure
 * mechanics ("the witness is data, not a script") and are conveyed by the
 * witness pane instead. The two rule steps that carry actual teaching value
 * — the P2WSH hash-check (witness_script_check) and the P2WPKH scriptCode
 * derivation (scriptcode_derive) — are intentionally NOT hidden: they are
 * walked as Rule steps, symmetric with the P2SH and Taproot commitment
 * checks. Hiding is keyed on the machine step name, not the phase, so those
 * two remain visible even though they share phase "witness".
 */
const HIDDEN_BOOKKEEPING_STEPS = new Set(["witness_program_match", "witness_load"]);

// Conditional-control opcodes are processed by the engine even inside a
// branch that is not taken (they steer which branch is live), so a
// branch_active:false on them must not read as "skipped".
const CONTROL_FLOW_MARKERS = new Set(["OP_IF", "OP_NOTIF", "OP_ELSE", "OP_ENDIF"]);

const isHiddenBookkeeping = (step: StepData) =>
  HIDDEN_BOOKKEEPING_STEPS.has(step.step ?? "");

interface ValidatorStepInfo {
  bip: string;
  title: string;
  explain: string;
}

const validatorStepInfo = (step: StepData): ValidatorStepInfo => {
  switch (step.step ?? step.opcode_name) {
    case "witness_program_match":
      return {
        bip: "BIP141",
        title: "scriptPubKey matches a v0 witness program",
        explain:
          "To a pre-SegWit node this input is already valid — executing the " +
          "scriptPubKey left a truthy value on the stack. SegWit nodes " +
          "recognize the version-0 pattern and continue with witness " +
          "validation on a fresh stack.",
      };
    case "witness_load":
      return {
        bip: "BIP141",
        title: `Load witness item ${(step.witness_index ?? 0) + 1}/${
          step.witness_total ?? "?"
        } onto the stack`,
        explain:
          "Deserialized from the witness by the validator — nothing " +
          "executes. The length byte in front of the item is VarInt " +
          "framing, not a push opcode.",
      };
    case "scriptcode_derive":
      return {
        bip: "BIP143",
        title: "Derive scriptCode from the witness program",
        explain:
          "The scriptPubKey is a pattern, not a program. The validator " +
          "expands its 20-byte hash into the implied P2PKH template — the " +
          "scriptCode — which is what actually executes. This script was " +
          "never transmitted.",
      };
    case "witness_script_check":
      return {
        bip: "BIP141",
        title: "Hash-check the witnessScript",
        explain:
          "The validator pops the last witness item and requires " +
          "SHA256(item) to equal the 32-byte program committed in the " +
          "scriptPubKey. The item itself becomes the executable " +
          "witnessScript.",
      };
    case "witness_script":
      return {
        bip: "BIP141",
        title: "Load the witness stack",
        explain:
          "The witness items are deserialized directly onto the stack by " +
          "the validator — the witness is data, not a script.",
      };
    // Live traces carry step="witness_stack"/"sighash"/…; older cached
    // traces and fixtures may only carry opcode_name="taproot_witness"/….
    // Both spellings map to the same curated explanations.
    case "witness_stack":
    case "taproot_witness":
      return {
        bip: "BIP341",
        title: "Load the witness stack",
        explain:
          "The witness items are deserialized directly onto the stack by " +
          "the validator.",
      };
    case "sighash":
    case "taproot_sighash":
      return {
        bip: "BIP341",
        title: "Compute the Taproot sighash",
        explain:
          "The validator computes the tagged sighash that the Schnorr " +
          "signature must commit to.",
      };
    case "schnorr_verify":
    case "taproot_schnorr_verify":
      return {
        bip: "BIP340",
        title: "Verify the Schnorr signature",
        explain:
          "The validator checks the Schnorr signature against the output " +
          "key and the tagged sighash.",
      };
    case "control_block":
    case "taproot_control_block":
      return {
        bip: "BIP341",
        title: "Verify the control block commitment",
        explain:
          "The validator hashes the revealed script into a tapleaf, climbs " +
          "the Merkle path from the control block, tweaks the internal key " +
          "with the resulting root, and requires the tweaked key to match " +
          "the 32-byte output key in the scriptPubKey.",
      };
    case "leaf_version":
    case "taproot_leaf_version":
      return {
        bip: "BIP341",
        title: "Check the tapleaf version",
        explain:
          "Only leaf version 0xc0 (tapscript) has defined execution rules. " +
          "Other versions are reserved for future soft forks: the control " +
          "block must still commit to the leaf, but the script is not " +
          "executed and the spend is deemed valid — while standard policy " +
          "discourages relaying such spends today.",
      };
    case "op_success":
      return {
        bip: "BIP342",
        title:
          step.policy === "discouraged"
            ? "OP_SUCCESS (discouraged by policy)"
            : "OP_SUCCESS — leaf succeeds without executing",
        explain:
          "The tapscript contains an OP_SUCCESSx opcode. Under consensus " +
          "the whole leaf immediately succeeds and its remaining opcodes " +
          "are never executed (they are reserved for future upgrades). " +
          (step.policy === "discouraged"
            ? "Standard policy discourages relaying such spends, so this " +
              "flag combination rejects it."
            : "Standard relay policy discourages this, but consensus accepts it."),
      };
    case "taproot_annex":
      return {
        bip: "BIP341",
        title: "Process the annex",
        explain:
          "The witness ends with an annex (a 0x50-prefixed element). It is " +
          "stripped from the stack before execution and its hash is folded " +
          "into the signature message, so signatures commit to it even " +
          "though the script never sees it.",
      };
    case "trace_truncated":
      return {
        bip: "",
        title: "Trace truncated",
        explain:
          "The execution trace reached the recording limit, so the " +
          "remaining steps were not captured. Execution itself ran to " +
          "completion — the verdict above reflects the full run.",
      };
    default:
      return {
        bip: "",
        title: step.opcode_name ?? step.step ?? "unrecognized step",
        explain: "",
      };
  }
};

function WitnessStackPane({
  items,
  consumed,
  highlighted = false,
}: {
  items: string[];
  consumed?: boolean[];
  highlighted?: boolean;
}) {
  if (!items.length) return null;

  return (
    <div className="mb-3 text-xs">
      <div className="mb-1 font-semibold text-primary">
        witnessStack (top → first):
      </div>
      <div className="field-surface max-h-28 overflow-auto rounded-md border p-2 break-words font-mono space-y-1">
        {items.map((it, i) => (
          <div
            key={`${it}-${i}`}
            className={cn(
              "whitespace-pre-wrap",
              highlighted && consumed?.[i] && "font-semibold text-primary",
            )}
          >
            {it}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Serialized witness for SegWit v0 inputs: VarInt item count, then each
 * item as VarInt length prefix + payload. Pure data — nothing executes —
 * rendered in the same quiet style as the other panes, with the framing
 * bytes dimmed so the stack items themselves stand out.
 */
function WitnessPane({ items }: { items: string[] }) {
  if (!items.length) return null;

  return (
    <div className="mb-3 text-xs" data-testid="witness-pane">
      <div className="mb-1 font-semibold text-primary">
        witness{" "}
        <span className="font-normal text-muted-foreground">
          (VarInt-framed stack items — not a script)
        </span>
        :
      </div>
      <div className="field-surface max-h-28 overflow-auto rounded-md border p-2 break-words font-mono leading-relaxed">
        <span
          className="text-muted-foreground/55"
          title={`item count (VarInt): ${items.length}`}
        >
          {varIntHex(items.length)}
        </span>
        {items.map((item, i) => (
          <span key={`${item}-${i}`}>
            {" "}
            <span
              className="text-muted-foreground/55"
              title={`item ${i + 1} length (VarInt): ${item.length / 2} bytes — framing, not a push opcode`}
            >
              {varIntHex(item.length / 2)}
            </span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function StackColumn({
  title,
  items,
  consumed,
}: {
  title: string;
  items: string[];
  consumed?: boolean[];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 font-semibold text-primary">{title}</div>
      <div className="space-y-1">
        {items.length ? (
          items.map((it, i) => (
            <div
              key={`${title}-${i}`}
              className={cn(
                "field-surface min-h-9 rounded-md border p-2 break-words",
                consumed?.[i] && "font-semibold text-primary",
              )}
            >
              {it}
            </div>
          ))
        ) : (
          <div className="min-h-9 rounded-md border border-dashed border-border/70 bg-muted/20 p-2 text-muted-foreground">
            empty
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- opcode cheat-sheet ----------------------------------- */
const OPCODES: Record<string, string> = {
  /* constant pushes */
  OP_0: "Push an empty byte array, interpreted as false / 0.",
  OP_1NEGATE: "Push the number -1.",
  OP_1: "Push number 1.", // OP_TRUE
  OP_2: "Push number 2.",
  OP_3: "Push number 3.",
  OP_4: "Push number 4.",
  OP_5: "Push number 5.",
  OP_6: "Push number 6.",
  OP_7: "Push number 7.",
  OP_8: "Push number 8.",
  OP_9: "Push number 9.",
  OP_10: "Push number 10.",
  OP_11: "Push number 11.",
  OP_12: "Push number 12.",
  OP_13: "Push number 13.",
  OP_14: "Push number 14.",
  OP_15: "Push number 15.",
  OP_16: "Push number 16.",

  /* stack operations */
  OP_DUP: "Duplicate the top stack item.",
  OP_DROP: "Remove the top stack item.",
  OP_NIP: "Remove the second item from the top of the stack.",
  OP_OVER: "Copy the second item from the top onto the top.",
  OP_PICK: "Consume n, then copy the item n positions back to the top.",
  OP_ROLL: "Consume n, then move the item n positions back to the top.",
  OP_SWAP: "Swap the top two stack items.",
  OP_TUCK: "Copy the top item beneath the second item.",
  OP_2DROP: "Remove the top two stack items.",
  OP_2DUP: "Duplicate the top two stack items.",
  OP_3DUP: "Duplicate the top three stack items.",
  OP_2OVER: "Copy the 3rd and 4th stack items to the top.",
  OP_2ROT: "Move the 5th and 6th stack items to the top.",
  OP_2SWAP: "Swap the top two pairs of stack items.",

  /* splice */
  OP_SIZE: "Push the byte length of the top item without removing it.",

  /* logic */
  OP_EQUAL: "Compare the top two byte arrays; push true if equal, else false.",
  OP_EQUALVERIFY:
    "Consume and compare the top two byte arrays; fail immediately if they differ.",
  OP_VERIFY:
    "Consume the top item; continue only if it is true, otherwise fail.",
  OP_IF: "Consume a boolean; execute the THEN branch if it is true.",
  OP_NOTIF: "Consume a boolean; execute the THEN branch if it is false.",
  OP_ELSE: "Start the ELSE branch.",
  OP_ENDIF: "End IF/ELSE.",
  OP_BOOLOR: "Push true if either of the top two numbers is non-zero.",
  OP_BOOLAND: "Push true if both of the top two numbers are non-zero.",
  OP_NUMEQUAL: "Compare the top two numbers; push true if equal, else false.",
  OP_WITHIN:
    "Check whether x is in range: min <= x < max; push true or false.",

  /* arithmetic (minimal encode rules apply) */
  OP_ADD: "Add the top two numbers and push the result.",
  OP_SUB: "Subtract the top number from the second number.",
  OP_NEGATE: "Negate the top number.",
  OP_ABS: "Replace the top number with its absolute value.",
  OP_1ADD: "Add 1 to the top number.",
  OP_1SUB: "Subtract 1 from the top number.",

  /* crypto */
  OP_SHA256: "Replace the top item with SHA-256(item).",
  OP_HASH160: "Replace the top item with RIPEMD-160(SHA-256(item)).",
  OP_RIPEMD160: "Replace the top item with RIPEMD-160(item).",
  OP_SHA1: "Replace the top item with SHA-1(item).",
  OP_HASH256: "Replace the top item with SHA-256(SHA-256(item)).",
  OP_CHECKSIG:
    "Check a signature against a public key and the transaction digest; push true or false.",
  OP_CHECKSIGVERIFY:
    "Run OP_CHECKSIG, then fail immediately if the result is false.",
  OP_CHECKSIGADD:
    "Taproot multisig helper: valid signature increments the counter, empty signature leaves it unchanged, invalid signature fails.",
  OP_CHECKMULTISIG:
    "Validate m-of-n ECDSA signatures against public keys; push true or false.",
  OP_CHECKMULTISIGVERIFY:
    "Run OP_CHECKMULTISIG, then fail immediately if the result is false.",
  OP_CHECKLOCKTIMEVERIFY:
    "Require the transaction nLockTime to satisfy the top stack value.",
  OP_CHECKSEQUENCEVERIFY:
    "Require the input relative locktime to satisfy the top stack value.",

  /* pseudo-op for all small pushes handled in code */
  OP_PUSHDATA: "Push raw bytes onto the stack.",

  /* discouraged or disabled (short description so users know why) */
  OP_NOP1: "NOP (reserved for soft-fork).",
  OP_NOP2: "NOP (became OP_CHECKLOCKTIMEVERIFY).",
  OP_NOP3: "NOP (became OP_CHECKSEQUENCEVERIFY).",
  OP_NOP4: "Reserved NOP.",
  OP_NOP5: "Reserved NOP.",
  OP_NOP6: "Reserved NOP.",
  OP_NOP7: "Reserved NOP.",
  OP_NOP8: "Reserved NOP.",
  OP_NOP9: "Reserved NOP.",
  OP_NOP10: "Reserved NOP.",
  OP_RETURN: "Fail immediately; commonly used to make outputs unspendable.",
  /* you can continue with OP_CODESEPARATOR, OP_CAT (disabled)… */
};

/**
 * Curated one-line explanations for the machine `error_code` that the
 * validator attaches to a terminal failure step. Purely additive: the raw
 * `error` message is always shown; this adds a friendlier gloss when the
 * code is recognized, and is silently skipped otherwise.
 */
const ERROR_CODE_EXPLAIN: Record<string, string> = {
  WITNESS_PROGRAM_MISMATCH:
    "The revealed script/key does not hash to the program committed in the scriptPubKey.",
  WITNESS_PROGRAM_WITNESS_EMPTY: "A witness program requires a non-empty witness.",
  WITNESS_PROGRAM_WRONG_LENGTH:
    "The witness program length does not match any known version (20 or 32 bytes).",
  WITNESS_MALLEATED: "A native witness spend must have an empty scriptSig.",
  WITNESS_UNEXPECTED: "Witness data was supplied for a non-witness output.",
  TWEAK_MISMATCH:
    "The Taproot output key is not the internal key tweaked by this script tree — the control block does not commit to this leaf.",
  TAPROOT_WRONG_CONTROL_SIZE:
    "The control block length is invalid (must be 33 + 32·k bytes).",
  SCHNORR_SIG_SIZE: "A Schnorr signature must be 64 or 65 bytes.",
  SCHNORR_SIG_HASHTYPE: "The signature's sighash byte is not a valid type.",
  SCHNORR_SIG: "The Schnorr signature failed verification against the key and sighash.",
  MISSING_SPENT_OUTPUTS:
    "Taproot signature verification needs the spent outputs (amount + scriptPubKey) for every input.",
  SIGHASH_ERROR: "The signature hash could not be computed (e.g. SIGHASH_SINGLE with no matching output).",
  PUSH_SIZE: "A stack element exceeds the 520-byte maximum.",
  STACK_SIZE: "The stack exceeds the 1000-item limit.",
  SCRIPT_SIZE: "The script exceeds the maximum size.",
  BAD_OPCODE: "The script is not decodable (a truncated or invalid opcode).",
  UNBALANCED_CONDITIONAL: "An OP_IF/OP_NOTIF was never closed by OP_ENDIF.",
  EVAL_FALSE: "Execution finished with a false (or empty) value on top of the stack.",
  CLEANSTACK: "Execution left more than one item on the stack (CLEANSTACK requires exactly one).",
  CLEANSTACK_REQUIRES_P2SH: "Invalid flag combination: CLEANSTACK requires P2SH.",
  CLEANSTACK_REQUIRES_WITNESS: "Invalid flag combination: CLEANSTACK requires WITNESS.",
  WITNESS_REQUIRES_P2SH: "Invalid flag combination: WITNESS requires P2SH.",
  SIG_PUSHONLY: "The scriptSig must be push-only under SIGPUSHONLY.",
  DISCOURAGE_OP_SUCCESS: "OP_SUCCESSx is discouraged by standard relay policy.",
  DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM:
    "An unknown witness version is discouraged by standard relay policy.",
  DISCOURAGE_UPGRADABLE_TAPROOT_VERSION:
    "An unknown Taproot leaf version is discouraged by standard relay policy.",
};

const OPCODE_NAME_BY_BYTE = (() => {
  const map = new Map<number, string>();
  (Object.keys(OP_CODES) as OpCodeCategories[]).forEach((category) => {
    OP_CODES[category].forEach((item) => {
      if (item.hex.length !== 2) return;
      const value = parseInt(item.hex, 16);
      if (Number.isNaN(value)) return;
      map.set(value, item.name);
    });
  });
  return map;
})();

const prettify = (code: number | undefined, name: string | undefined) => {
  if (!name) {
    if (code === undefined) return "unknown step";
    if (code >= 1 && code <= 0x4b) return `PUSH ${code} bytes`;
    return (
      OPCODE_NAME_BY_BYTE.get(code) ??
      `opcode 0x${code.toString(16).padStart(2, "0")}`
    );
  }
  if (code === undefined) return name;
  if (!name.toLowerCase().includes("unknown opcode")) return name;
  if (code >= 1 && code <= 0x4b) return `PUSH ${code} bytes`;
  const known = OPCODE_NAME_BY_BYTE.get(code);
  return known ?? name;
};

const pushLenInParens = (n: string) =>
  Number(
    (/\((\d+)\s*bytes?\)/i.exec(n) ||
      /^PUSH\s+(\d+)\s*bytes?$/i.exec(n) ||
      [])[1] ?? 0
  );

const opcodeExplanation = (n: string | undefined) =>
  !n
    ? ""
    : n.startsWith("OP_PUSHDATA(") || /^PUSH\s+\d+\s*bytes?$/i.test(n)
      ? OPCODES.OP_PUSHDATA
      : OPCODES[n.split("(")[0].trim()] || "";

const verificationFailureSummary = (steps: StepData[], fallback?: string) => {
  if (!fallback) return null;

  const failedStepIndex = steps.findIndex((candidate) => candidate.failed);
  if (failedStepIndex === -1) return "Verification failed";

  const failedStep = steps[failedStepIndex];
  const label = isValidatorStep(failedStep)
    ? validatorStepInfo(failedStep).title
    : prettify(failedStep.opcode, failedStep.opcode_name);
  return `FAILED STEP ${failedStepIndex + 1}: ${label}`;
};

const hexToBytes = (hex = "") =>
  Array.from({ length: hex.length / 2 }, (_, i) => hex.slice(i * 2, i * 2 + 2));

const cleanHex = (hex = "") => hex.replace(/\s+/g, "").toLowerCase();

const isCanonicalP2shScriptPubKey = (hex = "") =>
  /^a914[0-9a-f]{40}87$/i.test(cleanHex(hex));

const p2shRedeemScriptFromTrace = (
  steps: StepData[],
  scriptPubKeyHex: string,
) => {
  if (!isCanonicalP2shScriptPubKey(scriptPubKeyHex)) return "";

  const hash160Step = steps.find(
    (candidate) =>
      candidate.phase === "scriptPubKey" &&
      candidate.pc === 0 &&
      prettify(candidate.opcode, candidate.opcode_name) === "OP_HASH160",
  );

  return hash160Step?.stack_before?.at(-1) ?? "";
};

function scriptByteRange(
  scriptHex: string,
  offset: number,
  pc: number,
  opcodeName: string,
) {
  const bytes = hexToBytes(scriptHex);
  const relPC = pc - offset;

  let len = pushLenInParens(opcodeName);

  if (len === 0 && relPC >= 0) {
    if (opcodeName === "OP_PUSHDATA1" && relPC + 1 < bytes.length) {
      len = 1 + parseInt(bytes[relPC + 1], 16);
    } else if (opcodeName === "OP_PUSHDATA2" && relPC + 2 < bytes.length) {
      len = 2 + parseInt(bytes[relPC + 2] + bytes[relPC + 1], 16);
    } else if (opcodeName === "OP_PUSHDATA4" && relPC + 4 < bytes.length) {
      len =
        4 +
        parseInt(
          bytes[relPC + 4] +
            bytes[relPC + 3] +
            bytes[relPC + 2] +
            bytes[relPC + 1],
          16,
        );
    }
  }

  const hiEnd = relPC + len;
  return { bytes, relPC, len, hiEnd };
}

function consumedFlags(
  before: string[],
  after: string[],
  op: string,
): boolean[] {
  switch (op) {
    case "OP_HASH160":
    case "OP_DUP":
      return before.map((_, idx) => idx === 0);
    case "OP_EQUALVERIFY":
    case "OP_EQUAL":
    case "OP_CHECKSIG":
    case "OP_CHECKSIGVERIFY":
      return before.map((_, idx) => idx < 2);
  }

  const afterCopy = [...after];
  return before.map((it) => {
    const pop = () => {
      const i = afterCopy.indexOf(it);
      if (i === -1) return true;
      afterCopy.splice(i, 1);
      return false;
    };
    switch (op) {
      case "OP_CHECKMULTISIG":
        return pop();
      default:
        return pop();
    }
  });
}

/* ---------- single pane ------------------------------------------- */

type PaneProps = RenderHighlightedScriptProps & {
  highlighted?: boolean;
  /** One-line origin note rendered next to the label. */
  caption?: string;
  /** Rendered instead of bytes when scriptHex is legitimately empty
      (e.g. an empty tapscript leaf). Without it, an empty pane hides. */
  emptyNote?: string;
};

function ScriptPane({
  scriptHex,
  offset,
  pc,
  opcodeName,
  label,
  highlighted = true,
  caption,
  emptyNote,
}: PaneProps) {
  if (!scriptHex && !emptyNote) return null;
  if (!scriptHex) {
    return (
      <div className="mb-3 text-xs" data-testid={`${label}-script-pane`}>
        <div className="mb-1 font-semibold text-primary">
          {label}
          {caption && (
            <span className="font-normal text-muted-foreground">
              {" "}
              ({caption})
            </span>
          )}
          :
        </div>
        <div className="field-surface rounded-md border p-2 font-mono italic text-muted-foreground">
          {emptyNote}
        </div>
      </div>
    );
  }

  const { bytes, relPC, len, hiEnd } = scriptByteRange(
    scriptHex,
    offset,
    pc,
    opcodeName,
  );
  return (
    <div className="mb-3 text-xs" data-testid={`${label}-script-pane`}>
      <div className="mb-1 font-semibold text-primary">
        {label}
        {caption && (
          <span className="font-normal text-muted-foreground">
            {" "}
            ({caption})
          </span>
        )}
        :
      </div>
      <div className="field-surface max-h-24 overflow-auto rounded-md border p-2 break-words font-mono leading-relaxed">
        {bytes.map((b, i) => {
          if (!highlighted)
            return (
              <span
                key={i}
                className="text-muted-foreground/55"
              >
                {b}
              </span>
            );
          if (i === relPC)
            return (
              <span
                key={i}
                className="rounded-sm border border-primary/50 bg-primary/15 px-0.5 font-semibold text-primary shadow-sm"
              >
                {b}
              </span>
            );
          if (len && i > relPC && i <= hiEnd)
            return (
              <span
                key={i}
                className="bg-primary/10 italic text-primary/75"
              >
                {b}
              </span>
            );
          return <span key={i}>{b}</span>;
        })}
      </div>
    </div>
  );
}

/* ---------- error boundary ----------------------------------------- */

/**
 * Traces come from the backend (and from older cached lessons), so their
 * shape is ultimately not under this component's control. Without a
 * boundary a single malformed step used to white-screen the whole app;
 * this catches the render error and keeps a working dialog with a Close
 * button instead.
 */
class TraceErrorBoundary extends Component<
  { open: boolean; onClose: () => void; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { open: boolean }) {
    // Clear a caught error when the dialog is reopened, so the next open
    // retries a fresh render. Resetting on the closed→open edge (rather
    // than remounting via a key) preserves Radix's open/close animation.
    if (this.state.error && this.props.open && !prevProps.open) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <Dialog open={this.props.open} onOpenChange={this.props.onClose}>
          <DialogContent className="border-border bg-card text-card-foreground">
            <DialogHeader>
              <DialogTitle>Script Execution Steps</DialogTitle>
              <DialogDescription>
                The trace viewer could not render this trace.
              </DialogDescription>
            </DialogHeader>
            <div className="script-execution-error break-words text-xs font-mono">
              {String(this.state.error)}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                className="select-none"
                onClick={this.props.onClose}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    return this.props.children;
  }
}

/* ---------- main component ---------------------------------------- */

function ScriptExecutionStepsInner({
  open,
  onClose,
  scriptResult,
  scriptSigInputHex,
  scriptPubKeyInputHex,
}: ScriptExecutionStepsProps) {
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIdx(0);
    setCopied(false);
  }, [scriptResult?.steps?.length, open]);

  /* callbacks */
  const prev = useCallback(() => setIdx((p) => Math.max(p - 1, 0)), []);
  const next = useCallback(
    () =>
      setIdx((p) => Math.min(p + 1, (scriptResult?.steps?.length ?? 1) - 1)),
    [scriptResult],
  );

  const copy = useCallback(() => {
    if (!scriptResult) return;
    const lines: string[] = [
      "===== Script Execution Steps =====",
      `isValid: ${scriptResult.isValid}`,
    ];
    if (scriptResult.error) lines.push(`FinalError: ${scriptResult.error}`);
    // Key-path means NO tapscript at all — presence-based, so an empty
    // tapscript leaf (witnessScript === "") is not misclassified.
    const taprootKeyPathCopy =
      (scriptResult.steps || []).some((s) => s.phase === "taproot") &&
      scriptResult.witnessScript === undefined &&
      !((scriptResult.steps ?? []) as StepData[]).some(
        (s) => s.step === "witness_script",
      );
    if (taprootKeyPathCopy) {
      lines.push(
        "Taproot key-path spend: no witnessScript; pseudo-steps: taproot_witness → taproot_sighash → taproot_schnorr_verify.",
      );
    }
    if (scriptResult.witnessStack?.length) {
      lines.push(`witnessStack: [${scriptResult.witnessStack.join(", ")}]`);
    }
    if (scriptResult.scriptCode) {
      lines.push(
        `scriptCode (BIP143, derived — never transmitted): ${scriptResult.scriptCode}`,
      );
    }
    lines.push("");
    // Mirror the dialog: hidden bookkeeping steps are not walked, so the
    // copied numbering matches the on-screen "Step N/M" indicator.
    const copySteps = ((scriptResult.steps ?? []) as StepData[]).filter(
      (s) => !isHiddenBookkeeping(s),
    );
    copySteps.forEach((s, i) => {
      const stackBefore = s.stack_before ?? [];
      const stackAfter = s.stack_after ?? [];
      const header = isValidatorStep(s)
        ? (() => {
            const info = validatorStepInfo(s);
            return `Step #${i + 1}  RULE${info.bip ? `(${info.bip})` : ""}: ${info.title}`;
          })()
        : `Step #${i + 1}  PC=${s.pc ?? -1}  opcode_name=${prettify(
            s.opcode,
            s.opcode_name,
          )}`;
      lines.push(
        header,
        ...(isValidatorStep(s) && s.script_hex
          ? [`script_hex: ${s.script_hex}`]
          : []),
        `StackBefore: [${stackBefore.join(", ")}]`,
        `StackAfter: [${stackAfter.join(", ")}]`,
        ...(s.failed ? [`ERROR: ${s.error ?? "Unknown error"}`] : []),
        "-----------",
      );
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [scriptResult]);

  const stopKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => e.stopPropagation(),
    [],
  );

  // The trace carries validator bookkeeping for SegWit inputs; the walker
  // hides only the pure mechanics (program match, item load) — the witness
  // pane explains those — while the hash-check and scriptCode-derivation
  // rules stay walkable (see isHiddenBookkeeping).
  const visibleSteps = ((scriptResult?.steps ?? []) as StepData[]).filter(
    (traceStep) => !isHiddenBookkeeping(traceStep),
  );

  /* placeholder if no trace */
  if (!open || !scriptResult || !visibleSteps.length) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="border-border bg-card text-card-foreground"
        onKeyDownCapture={stopKey}
      >
          <DialogHeader>
            <DialogTitle>Script Execution Steps</DialogTitle>
            <DialogDescription>No script trace available.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="select-none"
              onClick={onClose}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  /* ----- trace available ----- */
  const steps = visibleSteps;
  // A recalculation can shrink the trace while the dialog is open; the
  // reset effect only runs after render, so clamp idx for this render.
  const safeIdx = Math.min(idx, steps.length - 1);
  const step = steps[safeIdx];
  const phase = step.phase ?? "scriptSig";

  const ssHex =
    effectiveScriptHex(scriptSigInputHex) || scriptResult.scriptSig || "";
  const spkHex =
    effectiveScriptHex(scriptPubKeyInputHex) || scriptResult.scriptPubKey || "";
  const isTaprootTrace =
    steps.some((traceStep) => traceStep.phase === "taproot") ||
    /^5120[0-9a-f]{64}$/i.test(spkHex);
  const derivedRedeemHex = p2shRedeemScriptFromTrace(steps, spkHex);
  const redeemHex = scriptResult.redeemScript ?? derivedRedeemHex;

  // SegWit v0: the executed script is either the conjured BIP143 scriptCode
  // (P2WPKH) or the transmitted witnessScript (P2WSH). Older cached traces
  // stored the conjured template under `witnessScript`; detect that shape.
  const rawWitnessScript = scriptResult.witnessScript ?? "";
  const conjuredLegacyShape =
    !scriptResult.scriptCode &&
    /^76a914[0-9a-f]{40}88ac$/i.test(cleanHex(rawWitnessScript)) &&
    /^0014[0-9a-f]{40}$/i.test(cleanHex(spkHex));
  const scriptCodeHex = isTaprootTrace
    ? ""
    : (scriptResult.scriptCode ?? (conjuredLegacyShape ? rawWitnessScript : ""));
  const execHex = isTaprootTrace
    ? rawWitnessScript
    : scriptCodeHex || rawWitnessScript;
  const execLabel = isTaprootTrace
    ? "tapscript"
    : scriptCodeHex
      ? "scriptCode"
      : "witnessScript";
  // Taproot script-path: reflect the commitment/execution state the
  // validator reported on the witness_script event, so the tapscript pane
  // says whether the leaf was actually run (an OP_SUCCESS or unknown-version
  // leaf is committed but never executed).
  const witnessScriptStep = ((scriptResult.steps ?? []) as StepData[]).find(
    (s) => s.step === "witness_script",
  );
  // Script-path presence is a matter of the witness_script event (or the
  // stored key) EXISTING, never of the hex being non-empty: an empty
  // tapscript leaf is valid and must not masquerade as a key-path spend.
  const hasTapscript =
    witnessScriptStep !== undefined ||
    scriptResult.witnessScript !== undefined;
  const taprootExecCaption =
    witnessScriptStep === undefined
      ? undefined
      : witnessScriptStep.executed
        ? "revealed leaf — committed by the control block and executed"
        : witnessScriptStep.committed === true
          ? "revealed leaf — committed by the control block, but not executed"
          : witnessScriptStep.committed === false
            ? "revealed leaf — commitment not verified"
            : "revealed leaf — commitment status unavailable (older trace)";
  // P2WSH: only claim the hash check passed when it actually did — a
  // failed candidate is still shown, labelled as a mismatch.
  const p2wshCheckStep = ((scriptResult.steps ?? []) as StepData[]).find(
    (s) => s.step === "witness_script_check",
  );
  const execCaption = isTaprootTrace
    ? taprootExecCaption
    : scriptCodeHex
      ? "derived from scriptPubKey — BIP143, never transmitted"
      : p2wshCheckStep?.failed
        ? "last witness item — its SHA256 did not match the committed program"
        : "last witness item, hash-checked against the program";

  const witnessStack =
    scriptResult.witnessStack ??
    steps.find((s) => s.phase === "taproot" && Array.isArray(s.stack_before))
      ?.stack_before ??
    [];

  const witnessSpend =
    scriptResult.usesWitness ??
    (witnessStack.length > 0 ||
      isTaprootTrace ||
      ((scriptResult.steps ?? []) as StepData[]).some(
        (s) => s.phase === "witness",
      ));

  const validatorCurrent = isValidatorStep(step);
  const validatorInfo = validatorCurrent ? validatorStepInfo(step) : null;

  // B15: an opcode inside a not-taken IF/ELSE branch is processed (the
  // engine still tracks nesting) but does not run. The library marks it
  // branch_active:false; we render it dimmed with a badge so learners don't
  // mistake a skipped opcode for one that executed. Conditional-control
  // opcodes are the exception: they run regardless, so they get their own
  // badge and keep full opacity.
  const branchInactive = step.branch_active === false;
  const controlFlowMarker =
    branchInactive && CONTROL_FLOW_MARKERS.has(step.opcode_name ?? "");
  const branchSkipped = branchInactive && !controlFlowMarker;

  const pretty = prettify(step.opcode, step.opcode_name);
  const explain = controlFlowMarker
    ? "This opcode manages the IF/ELSE branch structure, so the engine " +
      "processes it even inside a branch that is not taken — it updates " +
      "which branch is live but touches nothing on the stack."
    : branchSkipped
      ? "This opcode is inside a branch that was not taken, so it is skipped — " +
        "the stack is unchanged. It still counts toward script limits and, if " +
        "it is a disabled or always-invalid opcode, still fails the script."
      : validatorCurrent
        ? (validatorInfo?.explain ?? "")
        : opcodeExplanation(pretty);

  const stepStackBefore = step.stack_before ?? [];
  const stepStackAfter = step.stack_after ?? [];
  const beforeR = [...stepStackBefore].reverse();
  const afterR = [...stepStackAfter].reverse();
  const consumed = consumedFlags(beforeR, afterR, step.opcode_name ?? "");
  const taprootPhase = phase === "taproot";
  const isTaprootKeyPath = taprootPhase && !hasTapscript;
  const witnessStackDisplay = taprootPhase
    ? beforeR
    : [...witnessStack].reverse();
  // The legacy list stays for Taproot; SegWit v0 uses the serialized pane.
  const showWitnessStack =
    isTaprootTrace &&
    (taprootPhase || !rawWitnessScript) &&
    witnessStackDisplay.length > 0;
  const showWitnessPane = !isTaprootTrace && witnessStack.length > 0;

  // SegWit v0: two one-time notes around the phase switch. On the last
  // scriptPubKey step, explain the verdict old nodes stop at; on the first
  // scriptCode/witnessScript step, explain the fresh-stack second run —
  // the stack jump would otherwise be unexplained. The old-rules note keys
  // on the scriptPubKey→witness boundary (not simply the step before the
  // first executed step) so it stays put now that the derivation rule step
  // is walked between them.
  const firstExecIdx = steps.findIndex((s) => s.phase === "witnessScript");
  const lastScriptPubKeyIdx = steps.reduce(
    (acc, s, i) => (s.phase === "scriptPubKey" ? i : acc),
    -1,
  );
  const segwitV0Notes = !isTaprootTrace && !!execHex && firstExecIdx > -1;
  const transitionNote =
    segwitV0Notes && lastScriptPubKeyIdx > -1 && safeIdx === lastScriptPubKeyIdx
      ? "For old nodes the script ends here: the top of the stack is not " +
        "zero, so the spend is valid under their rules."
      : segwitV0Notes && safeIdx === firstExecIdx
        ? scriptCodeHex
          ? "A SegWit node starts a second run — the witness items become " +
            "the new stack, and the executed script is the scriptCode, " +
            "which carries the same 20-byte hash as the scriptPubKey."
          : "A SegWit node starts a second run — the remaining witness " +
            "items become the new stack, and the last item becomes the " +
            "executed witnessScript after its SHA256 matches the 32-byte " +
            "hash in the scriptPubKey."
        : "";

  const phaseText = phaseTextFor(phase, execLabel);
  // Scan the same filtered list the walker numbers, so "FAILED STEP N"
  // always points at a step the user can actually navigate to. A failure
  // inside the filtered witness bookkeeping falls back to the generic
  // summary instead of an off-by-k index.
  const failureSummary = verificationFailureSummary(steps, scriptResult.error);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-3xl border-border bg-card text-card-foreground shadow-xl shadow-foreground/10"
        onKeyDownCapture={stopKey}
      >
        <DialogHeader>
          <DialogTitle className="text-primary">
            Script Execution Steps
          </DialogTitle>
          <DialogDescription>
            Live walk-through of the script execution. Use the navigation.
          </DialogDescription>
        </DialogHeader>

        {/* navigation stays outside the scroll area */}
        <div
          data-testid="script-step-navigation"
          className="mb-3 flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 p-2"
        >
          <Button
            variant="outline"
            size="sm"
            className="select-none"
            onClick={prev}
            disabled={safeIdx === 0}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="select-none"
            onClick={next}
            disabled={safeIdx === steps.length - 1}
          >
            Next
          </Button>
          <div className="mx-2 text-sm text-muted-foreground">
            Step {safeIdx + 1}/{steps.length} — {phaseText}
          </div>
        </div>

        <div
          data-testid="script-step-scroll"
          className="h-[min(680px,65vh)] overflow-y-auto px-1"
        >
          {isTaprootKeyPath && (
            <div className="mb-3 rounded-md border border-primary/20 bg-muted/40 p-3 text-xs text-muted-foreground">
              Taproot key-path spend: no witnessScript is executed. The
              pseudo-steps below load the witness stack, compute the Taproot
              tagged sighash, and verify the Schnorr signature against the
              output key.
            </div>
          )}
          {/* panes */}
          {!ssHex && witnessSpend ? (
            <div className="mb-3 text-xs" data-testid="scriptSig-empty-pane">
              <div className="mb-1 font-semibold text-primary">
                scriptSig{" "}
                <span className="font-normal text-muted-foreground">
                  (unlocking data moved to the witness)
                </span>
                :
              </div>
              <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-2 text-muted-foreground">
                empty
              </div>
            </div>
          ) : (
            <ScriptPane
              scriptHex={ssHex}
              offset={0}
              pc={phase === "scriptSig" ? (step.pc ?? -1) : -1}
              opcodeName={pretty}
              label="scriptSig"
              highlighted={phase === "scriptSig"}
              isInScriptPubKey={false}
            />
          )}
          <ScriptPane
            scriptHex={spkHex}
            offset={0}
            pc={phase === "scriptPubKey" ? (step.pc ?? -1) : -1}
            opcodeName={pretty}
            label="scriptPubKey"
            highlighted={phase === "scriptPubKey"}
            isInScriptPubKey={true}
          />
          {redeemHex && (
            <ScriptPane
              scriptHex={redeemHex}
              offset={0}
              pc={phase === "redeemScript" ? (step.pc ?? -1) : -1}
              opcodeName={pretty}
              label="redeemScript"
              highlighted={phase === "redeemScript"}
              isInScriptPubKey={false}
            />
          )}
          {showWitnessPane && <WitnessPane items={witnessStack} />}
          {(execHex || (isTaprootTrace && hasTapscript)) && (
            <ScriptPane
              scriptHex={execHex}
              offset={0}
              pc={
                phase === "witnessScript" || phase === "taproot"
                  ? (step.pc ?? -1)
                  : -1
              }
              opcodeName={pretty}
              label={execLabel}
              caption={execCaption}
              emptyNote={
                isTaprootTrace && hasTapscript
                  ? "empty tapscript — no opcodes execute; the initial " +
                    "witness stack decides the outcome"
                  : undefined
              }
              highlighted={phase === "witnessScript" || phase === "taproot"}
              isInScriptPubKey={false}
            />
          )}
          {showWitnessStack && (
            <WitnessStackPane
              items={witnessStackDisplay}
              consumed={taprootPhase ? consumed : undefined}
              highlighted={taprootPhase}
            />
          )}

          {/* details */}
          <div className="space-y-3 rounded-md border border-border/70 bg-background/35 p-3 text-xs font-mono">
            {transitionNote && (
              <div className="text-muted-foreground">
                <em>{transitionNote}</em>
              </div>
            )}
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm text-muted-foreground",
                validatorCurrent
                  ? "script-execution-rule-surface"
                  : "border-primary/20 bg-primary/5",
                branchSkipped && "opacity-55",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-foreground">
                    {validatorCurrent ? "Rule:" : "Opcode:"}
                  </strong>{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      validatorCurrent
                        ? "script-execution-rule"
                        : "text-primary",
                    )}
                  >
                    {validatorCurrent ? validatorInfo?.title : pretty}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  {branchInactive && (
                    <span className="rounded-sm border border-muted-foreground/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {controlFlowMarker
                        ? "control-flow marker processed"
                        : "branch not executed"}
                    </span>
                  )}
                  {validatorCurrent && validatorInfo?.bip && (
                    <span className="script-execution-rule rounded-sm border border-current/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
                      {validatorInfo.bip}
                    </span>
                  )}
                  {step.failed && step.error && (
                    <span className="script-execution-error text-[11px] font-semibold uppercase tracking-wide">
                      Failed
                    </span>
                  )}
                </span>
              </div>
              {/* informational steps (e.g. trace_truncated) carry error
                  text without failed:true — show the detail either way */}
              {step.error && (
                <div className="script-execution-error mt-1 text-xs font-medium">
                  {step.error}
                </div>
              )}
              {step.error_code && ERROR_CODE_EXPLAIN[step.error_code] && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {ERROR_CODE_EXPLAIN[step.error_code]}
                </div>
              )}
            </div>
            {explain && (
              <div className="text-muted-foreground">
                <em>{explain}</em>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <StackColumn
                title="Stack Before (top → first)"
                items={beforeR}
                consumed={consumed}
              />
              <StackColumn title="Stack After (top → first)" items={afterR} />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          {failureSummary && (
            <div className="script-execution-error px-1 py-1 text-xs italic opacity-85">
              {failureSummary}
            </div>
          )}
          <div className="flex justify-end gap-2 sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="select-none"
              onClick={copy}
            >
              {copied ? "Copied!" : "Copy All"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="select-none"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ScriptExecutionSteps(props: ScriptExecutionStepsProps) {
  return (
    <TraceErrorBoundary open={props.open} onClose={props.onClose}>
      <ScriptExecutionStepsInner {...props} />
    </TraceErrorBoundary>
  );
}
