import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { FlowDialogLayer } from "@/components/FlowDialogLayer";

type ConfirmationDialogProps = {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmText?: string;
  children?: ReactNode;
  footerAction?: ReactNode;
};

type ConnectDialogProps = {
  open: boolean;
  onClose: () => void;
};

type ShareDialogProps = {
  open: boolean;
};

type SoftGateDialogProps = {
  open: boolean;
  onVerified: (token: string) => void;
};

const confirmationMocks: ConfirmationDialogProps[] = [];

vi.mock("@/components/dialog/confirmation-dialog", () => ({
  ConfirmationDialog: (props: ConfirmationDialogProps) => {
    confirmationMocks.push(props);
    return props.isOpen ? (
      <div data-testid={`dialog-${props.title}`}>
        {props.description}
        {props.children}
        {props.footerAction}
        <button onClick={props.onConfirm}>{props.confirmText}</button>
      </div>
    ) : null;
  },
}));

const connectMock = vi.fn();
vi.mock("@/components/dialog/ConnectDialog", () => ({
  __esModule: true,
  default: (props: ConnectDialogProps) => {
    connectMock(props);
    return props.open ? (
      <div data-testid="connect-dialog" onClick={() => props.onClose()}>
        connect
      </div>
    ) : null;
  },
}));

const shareDialogMock = vi.fn();
vi.mock("@/components/dialog/ShareDialog", () => ({
  ShareDialog: (props: ShareDialogProps) => {
    shareDialogMock(props);
    return props.open ? <div data-testid="share-dialog" /> : null;
  },
}));

const softGateMock = vi.fn();
vi.mock("@/components/share/SoftGateDialog", () => ({
  SoftGateDialog: (props: SoftGateDialogProps) => {
    softGateMock(props);
    return props.open ? (
      <button data-testid="softgate" onClick={() => props.onVerified("token")}>
        softgate
      </button>
    ) : null;
  },
}));

const baseProps = {
  closeDialog: { open: false, tabId: null },
  tabCount: 1,
  onConfirmTabClose: vi.fn(),
  onCancelTabClose: vi.fn(),
  onCloseAllTabs: vi.fn(),
  onCloseOtherTabs: vi.fn(),
  onResetWorkspace: vi.fn(),
  showSaveConfirmation: false,
  saveConfirmationMessage: "",
  onConfirmSave: vi.fn(),
  onCancelSave: vi.fn(),
  showLlmSaveConfirmation: false,
  llmSaveConfirmationMessage: "",
  onConfirmLlmSave: vi.fn(),
  onCancelLlmSave: vi.fn(),
  infoDialog: { open: false, message: "" },
  closeInfoDialog: vi.fn(),
  connectOpen: false,
  setConnectOpen: vi.fn(),
  allPorts: [],
  sourcePorts: null,
  targetPorts: null,
  existingEdges: [],
  onConnectApply: vi.fn(),
  shareDialogOpen: false,
  shareCreatedId: null,
  closeShareDialog: vi.fn(),
  requestShare: vi.fn(),
  softGateOpen: false,
  closeSoftGate: vi.fn(),
  verifyTurnstile: vi.fn().mockResolvedValue({ id: "token" }),
};

describe("FlowDialogLayer", () => {
  it("renders dialogs based on open flags", () => {
    render(
      <FlowDialogLayer
        {...baseProps}
        closeDialog={{ open: true, tabId: "tab-1" }}
        showSaveConfirmation
        saveConfirmationMessage="Save it?"
        showLlmSaveConfirmation
        llmSaveConfirmationMessage="Save llm?"
        infoDialog={{ open: true, message: "Info" }}
      />
    );

    expect(screen.getByTestId("dialog-Close Tab")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-Save Simplified Flow")).toHaveTextContent("Save it?");
    expect(screen.getByTestId("dialog-Save LLM Export")).toHaveTextContent("Save llm?");
    expect(screen.getByTestId("dialog-Information")).toHaveTextContent("Info");
  });

  it("mounts connect, share, and soft gate dialogs", () => {
    const setConnectOpen = vi.fn();
    render(
      <FlowDialogLayer
        {...baseProps}
        connectOpen
        setConnectOpen={setConnectOpen}
        shareDialogOpen
        softGateOpen
      />
    );

    expect(screen.getByTestId("connect-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("connect-dialog"));
    expect(setConnectOpen).toHaveBeenCalledWith(false);

    expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("softgate"));
    expect(baseProps.verifyTurnstile).toHaveBeenCalledWith("token");
  });

  it("selects an advanced close-tab action before confirming", () => {
    const onCloseAllTabs = vi.fn();
    const onCloseOtherTabs = vi.fn();
    const onResetWorkspace = vi.fn();
    const onConfirmTabClose = vi.fn();

    render(
      <FlowDialogLayer
        {...baseProps}
        closeDialog={{ open: true, tabId: "tab-2" }}
        tabCount={3}
        onConfirmTabClose={onConfirmTabClose}
        onCloseAllTabs={onCloseAllTabs}
        onCloseOtherTabs={onCloseOtherTabs}
        onResetWorkspace={onResetWorkspace}
      />
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: /choose close/i }), {
      key: "Enter",
    });
    expect(
      screen.queryByRole("menuitem", { name: "Close this tab" })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Close other tabs" })
    );
    expect(onConfirmTabClose).not.toHaveBeenCalled();
    expect(onCloseAllTabs).not.toHaveBeenCalled();
    expect(onCloseOtherTabs).not.toHaveBeenCalled();
    expect(onResetWorkspace).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: /choose close/i }), {
      key: "Enter",
    });
    expect(
      screen.queryByRole("menuitem", { name: "Close other tabs" })
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu", { name: /choose close/i }), {
      key: "Escape",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close other tabs" })
    );
    expect(onCloseOtherTabs).toHaveBeenCalledTimes(1);
  });
});
