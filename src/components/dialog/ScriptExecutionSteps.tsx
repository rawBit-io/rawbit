/* ---------------------------------------------------------------
 *  ScriptExecutionSteps.tsx  –  multi-phase trace viewer
 * --------------------------------------------------------------- */

import {
  useState,
  useEffect,
  useCallback,
  KeyboardEvent,
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
 * traces only have pseudo-steps at pc -1.
 */
const isValidatorStep = (step: StepData) =>
  step.kind === "validator" || step.pc < 0;

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
    case "taproot_witness":
      return {
        bip: "BIP341",
        title: "Load the witness stack",
        explain:
          "The witness items are deserialized directly onto the stack by " +
          "the validator.",
      };
    case "taproot_sighash":
      return {
        bip: "BIP341",
        title: "Compute the Taproot sighash",
        explain:
          "The validator computes the tagged sighash that the Schnorr " +
          "signature must commit to.",
      };
    case "taproot_schnorr_verify":
      return {
        bip: "BIP340",
        title: "Verify the Schnorr signature",
        explain:
          "The validator checks the Schnorr signature against the output " +
          "key and the tagged sighash.",
      };
    default:
      return { bip: "", title: step.opcode_name, explain: "" };
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

const prettify = (code: number | undefined, name: string) => {
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

const opcodeExplanation = (n: string) =>
  n.startsWith("OP_PUSHDATA(") || /^PUSH\s+\d+\s*bytes?$/i.test(n)
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
};

function ScriptPane({
  scriptHex,
  offset,
  pc,
  opcodeName,
  label,
  highlighted = true,
  caption,
}: PaneProps) {
  if (!scriptHex) return null;

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

/* ---------- main component ---------------------------------------- */

export default function ScriptExecutionSteps({
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
    const taprootKeyPathCopy =
      (scriptResult.steps || []).some((s) => s.phase === "taproot") &&
      !scriptResult.witnessScript;
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
    // Mirror the dialog: witness bookkeeping steps are not walked, so the
    // copied numbering matches the on-screen "Step N/M" indicator.
    const copySteps = ((scriptResult.steps ?? []) as StepData[]).filter(
      (s) => s.phase !== "witness",
    );
    copySteps.forEach((s, i) => {
      const stackBefore = s.stack_before ?? [];
      const stackAfter = s.stack_after ?? [];
      const header = isValidatorStep(s)
        ? (() => {
            const info = validatorStepInfo(s);
            return `Step #${i + 1}  RULE${info.bip ? `(${info.bip})` : ""}: ${info.title}`;
          })()
        : `Step #${i + 1}  PC=${s.pc}  opcode_name=${prettify(
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

  // The trace carries validator bookkeeping (phase "witness") for SegWit
  // inputs; the modal walks opcode steps only, P2SH-style — the pane
  // captions explain where derived data (scriptCode, witness items) comes
  // from instead of dedicating steps to it.
  const visibleSteps = ((scriptResult?.steps ?? []) as StepData[]).filter(
    (traceStep) => traceStep.phase !== "witness",
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
  const execCaption = isTaprootTrace
    ? undefined
    : scriptCodeHex
      ? "derived from scriptPubKey — BIP143, never transmitted"
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

  const pretty = prettify(step.opcode, step.opcode_name);
  const explain = validatorCurrent
    ? (validatorInfo?.explain ?? "")
    : opcodeExplanation(pretty);

  const stepStackBefore = step.stack_before ?? [];
  const stepStackAfter = step.stack_after ?? [];
  const beforeR = [...stepStackBefore].reverse();
  const afterR = [...stepStackAfter].reverse();
  const consumed = consumedFlags(beforeR, afterR, step.opcode_name);
  const taprootPhase = phase === "taproot";
  const isTaprootKeyPath = taprootPhase && !rawWitnessScript;
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
  // old-rules step, explain the verdict old nodes stop at; on the first
  // scriptCode/witnessScript step, explain the fresh-stack second run —
  // the stack jump would otherwise be unexplained.
  const firstExecIdx = steps.findIndex((s) => s.phase === "witnessScript");
  const segwitV0Notes = !isTaprootTrace && !!execHex && firstExecIdx > -1;
  const transitionNote =
    segwitV0Notes && firstExecIdx > 0 && safeIdx === firstExecIdx - 1
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
  const failureSummary = verificationFailureSummary(
    (scriptResult.steps ?? []) as StepData[],
    scriptResult.error,
  );

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
              pc={phase === "scriptSig" ? step.pc : -1}
              opcodeName={pretty}
              label="scriptSig"
              highlighted={phase === "scriptSig"}
              isInScriptPubKey={false}
            />
          )}
          <ScriptPane
            scriptHex={spkHex}
            offset={0}
            pc={phase === "scriptPubKey" ? step.pc : -1}
            opcodeName={pretty}
            label="scriptPubKey"
            highlighted={phase === "scriptPubKey"}
            isInScriptPubKey={true}
          />
          {redeemHex && (
            <ScriptPane
              scriptHex={redeemHex}
              offset={0}
              pc={phase === "redeemScript" ? step.pc : -1}
              opcodeName={pretty}
              label="redeemScript"
              highlighted={phase === "redeemScript"}
              isInScriptPubKey={false}
            />
          )}
          {showWitnessPane && <WitnessPane items={witnessStack} />}
          {execHex && (
            <ScriptPane
              scriptHex={execHex}
              offset={0}
              pc={
                phase === "witnessScript" || phase === "taproot" ? step.pc : -1
              }
              opcodeName={pretty}
              label={execLabel}
              caption={execCaption}
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
              {step.failed && step.error && (
                <div className="script-execution-error mt-1 text-xs font-medium">
                  {step.error}
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
