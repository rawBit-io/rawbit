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

const phaseTextFor = (phase: string) =>
  phase === "scriptSig"
    ? "Phase 1 (scriptSig)"
    : phase === "scriptPubKey"
      ? "Phase 2 (scriptPubKey)"
      : phase === "redeemScript"
        ? "Phase 3 (redeemScript)"
        : phase === "taproot"
          ? "Phase 4 (taproot)"
          : "Phase 4 (witnessScript)";

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
  OP_0: "Push number 0 (empty byte array).",
  OP_1NEGATE: "Push -1.",
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
  OP_NIP: "Drop the 2nd item from the top.",
  OP_OVER: "Copy the 2nd item to the top.",
  OP_PICK: "Copy Nth stack item to top (leave in place).",
  OP_ROLL: "Move Nth item to top (remove from original).",
  OP_SWAP: "Swap top two items.",
  OP_TUCK: "Copy top item beneath second item.",
  OP_2DROP: "Remove top two items.",
  OP_2DUP: "Duplicate top two items.",
  OP_3DUP: "Duplicate top three items.",
  OP_2OVER: "Copy items #3‒4 to top of stack.",
  OP_2ROT: "Rotate top six items left twice.",
  OP_2SWAP: "Swap the top two pairs.",

  /* splice */
  OP_SIZE: "Push size (bytes) of top item.",

  /* logic */
  OP_EQUAL: "Push 1 if top two items are byte-equal.",
  OP_EQUALVERIFY: "Equal then OP_VERIFY.",
  OP_VERIFY: "Fail the script if top item is false.",
  OP_IF: "If (bool) execute the THEN branch.",
  OP_NOTIF: "If NOT bool execute the THEN branch.",
  OP_ELSE: "Start the ELSE branch.",
  OP_ENDIF: "End IF/ELSE.",
  OP_BOOLOR: "Boolean OR.",
  OP_BOOLAND: "Boolean AND.",
  OP_NUMEQUAL: "Numeric equality (deprecated for consensus).",
  OP_WITHIN: "x min ≤ x < max ? 1 : 0",

  /* arithmetic (minimal encode rules apply) */
  OP_ADD: "a + b",
  OP_SUB: "a − b",
  OP_NEGATE: "Unary minus.",
  OP_ABS: "Absolute value.",
  OP_1ADD: "Add 1.",
  OP_1SUB: "Subtract 1.",

  /* crypto */
  OP_SHA256: "SHA-256 hash.",
  OP_HASH160: "RIPEMD-160(SHA-256(x)).",
  OP_RIPEMD160: "RIPEMD-160 hash.",
  OP_SHA1: "SHA-1 hash.",
  OP_HASH256: "Double SHA-256.",
  OP_CHECKSIG: "Verify signature against pubkey & tx hash.",
  OP_CHECKSIGVERIFY: "CHECKSIG then VERIFY.",
  OP_CHECKSIGADD:
    "Pop sig, counter, pubkey. Valid sig → counter+1; empty sig → counter unchanged; invalid non-empty → FAIL.",
  OP_CHECKMULTISIG: "m-of-n multisig validation.",
  OP_CHECKMULTISIGVERIFY: "CHECKMULTISIG then VERIFY.",
  OP_CHECKLOCKTIMEVERIFY: "Require nLockTime ≥ value.",
  OP_CHECKSEQUENCEVERIFY: "Require relative-locktime ≥ value.",

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
  OP_RETURN: "Mark transaction output as provably unspendable.",
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

const hexToBytes = (hex = "") =>
  Array.from({ length: hex.length / 2 }, (_, i) => hex.slice(i * 2, i * 2 + 2));

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
  const afterCopy = [...after];
  return before.map((it, idx) => {
    const pop = () => {
      const i = afterCopy.indexOf(it);
      if (i === -1) return true;
      afterCopy.splice(i, 1);
      return false;
    };
    switch (op) {
      case "OP_HASH160":
      case "OP_DUP":
        return idx === 0;
      case "OP_EQUALVERIFY":
      case "OP_EQUAL":
      case "OP_CHECKSIG":
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
    <div className="mb-3 text-xs">
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
        `Step #${i}  PC=${s.pc}  opcode_name=${prettyName}`,
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
  const step = steps[idx];
  const phase = step.phase ?? "scriptSig";

  const ssHex = scriptSigInputHex || scriptResult.scriptSig || "";
  const spkHex = scriptPubKeyInputHex || scriptResult.scriptPubKey || "";
  const redeemHex = scriptResult.redeemScript ?? "";
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

  const phaseText = phaseTextFor(phase);

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

        <div className="h-[600px] overflow-y-auto px-1">
          {/* navigation */}
          <div className="mb-3 flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 p-2">
            <Button
              variant="outline"
              size="sm"
              className="select-none"
              onClick={prev}
              disabled={idx === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="select-none"
              onClick={next}
              disabled={idx === steps.length - 1}
            >
              Next
            </Button>
            <div className="mx-2 text-sm text-muted-foreground">
              Step {idx + 1}/{steps.length} — {phaseText}
            </div>
          </div>

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
              label="witnessScript"
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
              <strong className="text-foreground">Opcode:</strong>{" "}
              <span className="font-semibold text-primary">{pretty}</span>
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

            {step.failed && step.error && (
              <div className="text-red-600 font-semibold">
                ERROR: {step.error}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2 sm:items-center sm:justify-between sm:space-x-0">
          {scriptResult?.error && (
            <div className="text-sm text-destructive">
              FinalError: {scriptResult.error}
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
