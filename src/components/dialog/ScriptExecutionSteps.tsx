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

/* ---------- helpers ------------------------------------------------ */

const phaseTextFor = (phase: string, phaseScriptLabel = "scriptCode") =>
  phase === "scriptSig"
    ? "Phase 1 (scriptSig)"
    : phase === "scriptPubKey"
      ? "Phase 2 (scriptPubKey)"
      : phase === "redeemScript"
        ? "Phase 3 (redeemScript)"
        : phase === "taproot"
          ? "Phase 4 (taproot)"
          : `Phase 4 (${phaseScriptLabel})`;

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
      <div className="field-surface h-28 overflow-auto rounded-md border p-2 break-words font-mono space-y-1">
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

const prettify = (code: number, name: string) => {
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
  return `FAILED STEP ${failedStepIndex + 1}: ${prettify(
    failedStep.opcode,
    failedStep.opcode_name,
  )}`;
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
};

function ScriptPane({
  scriptHex,
  offset,
  pc,
  opcodeName,
  label,
  highlighted = true,
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
      <div className="mb-1 font-semibold text-primary">{label}:</div>
      <div className="field-surface h-20 overflow-auto rounded-md border p-2 break-words font-mono leading-relaxed">
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
    if (scriptResult.witnessStack?.length && !scriptResult.witnessScript) {
      lines.push(`witnessStack: [${scriptResult.witnessStack.join(", ")}]`);
    }
    lines.push("");
    (scriptResult.steps || []).forEach((s, i) => {
      const stackBefore = s.stack_before ?? [];
      const stackAfter = s.stack_after ?? [];
      const prettyName = prettify(s.opcode, s.opcode_name);
      lines.push(
        `Step #${i + 1}  PC=${s.pc}  opcode_name=${prettyName}`,
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

  /* placeholder if no trace */
  if (!open || !scriptResult || !scriptResult.steps?.length) {
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
  const steps = scriptResult.steps as StepData[];
  // A recalculation can shrink the trace while the dialog is open; the
  // reset effect only runs after render, so clamp idx for this render.
  const safeIdx = Math.min(idx, steps.length - 1);
  const step = steps[safeIdx];
  const phase = step.phase ?? "scriptSig";

  const ssHex = scriptSigInputHex || scriptResult.scriptSig || "";
  const spkHex = scriptPubKeyInputHex || scriptResult.scriptPubKey || "";
  const isTaprootTrace =
    steps.some((traceStep) => traceStep.phase === "taproot") ||
    /^5120[0-9a-f]{64}$/i.test(spkHex);
  const phaseScriptLabel = isTaprootTrace ? "tapscript" : "scriptCode";
  const derivedRedeemHex = p2shRedeemScriptFromTrace(steps, spkHex);
  const redeemHex = scriptResult.redeemScript ?? derivedRedeemHex;
  const witnessHex = scriptResult.witnessScript ?? "";
  const witnessStack =
    scriptResult.witnessStack ??
    steps.find((s) => s.phase === "taproot" && Array.isArray(s.stack_before))
      ?.stack_before ??
    [];

  const pretty = prettify(step.opcode, step.opcode_name);
  const explain = opcodeExplanation(pretty);

  const stepStackBefore = step.stack_before ?? [];
  const stepStackAfter = step.stack_after ?? [];
  const beforeR = [...stepStackBefore].reverse();
  const afterR = [...stepStackAfter].reverse();
  const consumed = consumedFlags(beforeR, afterR, step.opcode_name);
  const taprootPhase = phase === "taproot";
  const isTaprootKeyPath = taprootPhase && !witnessHex;
  const witnessStackDisplay = taprootPhase
    ? beforeR
    : [...witnessStack].reverse();
  const showWitnessStack =
    (taprootPhase || !witnessHex) && witnessStackDisplay.length > 0;

  const phaseText = phaseTextFor(phase, phaseScriptLabel);
  const failureSummary = verificationFailureSummary(steps, scriptResult.error);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl border-border bg-card text-card-foreground shadow-xl shadow-foreground/10"
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

        <div data-testid="script-step-scroll" className="h-[540px] overflow-y-auto px-1">
          {isTaprootKeyPath && (
            <div className="mb-3 rounded-md border border-primary/20 bg-muted/40 p-3 text-xs text-muted-foreground">
              Taproot key-path spend: no witnessScript is executed. The
              pseudo-steps below load the witness stack, compute the Taproot
              tagged sighash, and verify the Schnorr signature against the
              output key.
            </div>
          )}
          {/* panes */}
          <ScriptPane
            scriptHex={ssHex}
            offset={0}
            pc={phase === "scriptSig" ? step.pc : -1}
            opcodeName={pretty}
            label="scriptSig"
            highlighted={phase === "scriptSig"}
            isInScriptPubKey={false}
          />
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
          {witnessHex && (
            <ScriptPane
              scriptHex={witnessHex}
              offset={0}
              pc={
                phase === "witnessScript" || phase === "taproot" ? step.pc : -1
              }
              opcodeName={pretty}
              label={phaseScriptLabel}
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
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-foreground">Opcode:</strong>{" "}
                  <span className="font-semibold text-primary">{pretty}</span>
                </div>
                {step.failed && step.error && (
                  <span className="script-execution-error text-[11px] font-semibold uppercase tracking-wide">
                    Failed
                  </span>
                )}
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
