import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  children?: ReactNode;
  footerAction?: ReactNode;
  confirmVariant?: ButtonProps["variant"];
  confirmClassName?: string;
  confirmText?: string;
  cancelText?: string;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  children,
  footerAction,
  confirmVariant = "default",
  confirmClassName,
  confirmText = "Confirm",
  cancelText,
}: ConfirmationDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          {footerAction && <div className="mr-auto">{footerAction}</div>}

          {/* Only show the cancel button if text is provided */}
          {cancelText && (
            <Button variant="outline" onClick={onClose}>
              {cancelText}
            </Button>
          )}

          <Button
            variant={confirmVariant}
            className={cn(confirmClassName)}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
