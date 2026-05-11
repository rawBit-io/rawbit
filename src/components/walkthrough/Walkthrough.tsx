import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WalkthroughStep {
  title: string;
  target: string;
  description: string;
}

interface WalkthroughProps {
  open: boolean;
  onSkip: () => void;
  onFinish: () => void;
  onStepChange?: (stepIndex: number) => void;
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    title: "Watch the sidebar",
    target: "Sidebar",
    description:
      "This walkthrough performs real canvas actions. Use Next to watch nodes drop in, fields fill, and ports connect.",
  },
  {
    title: "Drop an input node",
    target: "Input",
    description:
      "The first node comes from Canvas & Inputs and carries the transaction version value.",
  },
  {
    title: "Drop TX Template legacy",
    target: "TX Template legacy",
    description:
      "The transaction template is placed next to the input so the flow has a concrete target.",
  },
  {
    title: "Fill template fields",
    target: "Node fields",
    description:
      "rawBit fills version, input count, output count, and locktime with simple starter values.",
  },
  {
    title: "Connect the nodes",
    target: "Input -> VERSION[4]",
    description:
      "The input node output is connected into the template's VERSION[4] field.",
  },
  {
    title: "Copy and paste",
    target: "Topbar clipboard",
    description:
      "Next we can duplicate useful building blocks instead of rebuilding them.",
  },
  {
    title: "Group related nodes",
    target: "Group button",
    description:
      "Groups keep related parts of a flow readable as the graph gets larger.",
  },
  {
    title: "Example flows",
    target: "Flow Examples",
    description:
      "The walkthrough will end by opening Intro P2PKH as a real flow you can edit and explore.",
  },
];

export function Walkthrough({
  open,
  onSkip,
  onFinish,
  onStepChange,
}: WalkthroughProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const stepCount = WALKTHROUGH_STEPS.length;
  const currentStep = WALKTHROUGH_STEPS[stepIndex];
  const onStepChangeRef = useRef(onStepChange);
  const lastNotifiedStepRef = useRef<number | null>(null);
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === stepCount - 1;
  const progressLabel = useMemo(
    () => `${stepIndex + 1} / ${stepCount}`,
    [stepCount, stepIndex]
  );

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);

  useEffect(() => {
    if (open) {
      lastNotifiedStepRef.current = null;
      setStepIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (lastNotifiedStepRef.current === stepIndex) return;
    lastNotifiedStepRef.current = stepIndex;
    onStepChangeRef.current?.(stepIndex);
  }, [open, stepIndex]);

  const handleNext = () => {
    if (isLastStep) {
      onFinish();
      return;
    }
    setStepIndex((index) => Math.min(index + 1, stepCount - 1));
  };

  const handleBack = () => {
    setStepIndex((index) => Math.max(index - 1, 0));
  };

  if (!open) return null;

  return (
    <section
      data-testid="walkthrough-panel"
      aria-label="rawBit walkthrough"
      className={cn(
        "fixed bottom-5 right-5 z-[90] w-[min(22rem,calc(100vw-2rem))]",
        "rounded-md border border-border bg-background/95 text-foreground shadow-xl backdrop-blur",
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {currentStep.target}
          </div>
          <h2 className="mt-1 text-sm font-semibold leading-snug">
            {currentStep.title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {progressLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onSkip}
            aria-label="Close walkthrough"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {currentStep.description}
        </p>

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBack}
            disabled={isFirstStep}
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button size="sm" onClick={handleNext}>
            {isLastStep ? (
              "Finish"
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
