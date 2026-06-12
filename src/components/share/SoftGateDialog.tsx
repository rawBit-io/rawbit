// src/components/share/SoftGateDialog.tsx
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type TurnstileTheme = "light" | "dark" | "auto";

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: TurnstileTheme;
  callback: (token: string) => void;
  "error-callback"?: () => void;
}

interface Turnstile {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove?(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileScriptPromise: Promise<void> | null = null;

const loadTurnstileScript = (): Promise<void> => {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  const load = new Promise<void>((resolve, reject) => {
    const existing = document.head.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );
    const script = existing ?? document.createElement("script");
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Turnstile script failed to load"));
    };
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  turnstileScriptPromise = load.finally(() => {
    turnstileScriptPromise = null;
  });
  return turnstileScriptPromise;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onVerified: (token: string) => void;
  siteKey?: string;
};

export function SoftGateDialog({
  open,
  onClose,
  onVerified,
  siteKey = import.meta.env.VITE_TURNSTILE_SITEKEY,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Keep the latest onVerified in a ref so an unstable prop identity does not
  // force the widget effect to destroy and recreate the Turnstile widget.
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  useEffect(() => {
    if (!open) return;
    const ensure = async () => {
      try {
        await loadTurnstileScript();
        setLoadFailed(false);
        setReady(true);
      } catch {
        setLoadFailed(true);
      }
    };
    ensure();
  }, [open, loadAttempt]);

  useEffect(() => {
    if (!open || !ready || !ref.current || !window.turnstile) return;
    const widgetId = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      theme: "auto",
      callback: (token: string) => onVerifiedRef.current(token),
      "error-callback": () => {
        /* ignore */
      },
    });
    return () => {
      window.turnstile?.remove?.(widgetId);
    };
  }, [open, ready, siteKey]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick verification</DialogTitle>
          <DialogDescription>
            We limit shares during spikes to stop abuse.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center my-4">
          {loadFailed ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                The verification widget could not be loaded. Check your
                connection or content blocker, then try again.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div ref={ref} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
