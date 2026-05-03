import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useState } from "react";

import { usePanelAutoClose } from "../usePanelAutoClose";

describe("usePanelAutoClose", () => {
  it("closes error/search panels when the active tab changes", () => {
    const { result, rerender } = renderHook(
      ({ activeTabId, calcStatus, errorCount }: { activeTabId: string; calcStatus: "OK" | "CALC" | "ERROR"; errorCount: number }) => {
        const [showError, setShowError] = useState(true);
        const [showSearch, setShowSearch] = useState(true);

        usePanelAutoClose({
          activeTabId,
          calcStatus,
          errorCount,
          showErrorPanel: showError,
          setShowErrorPanel: setShowError,
          setShowSearchPanel: setShowSearch,
        });

        return {
          showError,
          showSearch,
          setShowError,
          setShowSearch,
        };
      },
      {
        initialProps: { activeTabId: "tab-1", calcStatus: "ERROR" as const, errorCount: 1 },
      }
    );

    act(() => {
      result.current.setShowError(true);
      result.current.setShowSearch(true);
    });

    rerender({ activeTabId: "tab-2", calcStatus: "ERROR", errorCount: 1 });

    expect(result.current.showError).toBe(false);
    expect(result.current.showSearch).toBe(false);
  });

  it("closes the error panel when status returns to OK", () => {
    type TestProps = { calcStatus: "OK" | "CALC" | "ERROR"; errorCount: number };

    const initialProps: TestProps = { calcStatus: "ERROR", errorCount: 2 };

    const { result, rerender } = renderHook(
      ({ calcStatus, errorCount }: TestProps) => {
        const [showError, setShowError] = useState(false);
        const [, setShowSearch] = useState(false);

        usePanelAutoClose({
          activeTabId: "tab-1",
          calcStatus,
          errorCount,
          showErrorPanel: showError,
          setShowErrorPanel: setShowError,
          setShowSearchPanel: setShowSearch,
        });

        return { showError, setShowError };
      },
      { initialProps }
    );

    act(() => {
      result.current.setShowError(true);
    });

    rerender({ calcStatus: "OK", errorCount: 0 });

    expect(result.current.showError).toBe(false);
  });
});
