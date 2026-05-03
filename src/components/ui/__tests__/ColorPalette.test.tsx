import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ColorPalette } from "../ColorPalette";

const defaultPosition = { x: 100, y: 100 };

describe("ColorPalette", () => {
  it("returns null when closed", () => {
    const { container } = render(
      <ColorPalette
        isOpen={false}
        position={defaultPosition}
        onColorSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("invokes onColorSelect with undefined when reset button clicked", () => {
    const onColorSelect = vi.fn();
    render(
      <ColorPalette
        isOpen
        position={defaultPosition}
        onColorSelect={onColorSelect}
        onClose={vi.fn()}
      />
    );

    const resetButton = document.querySelector(
      'button[title="Remove border color"]'
    ) as HTMLButtonElement;
    expect(resetButton).not.toHaveClass("border-dashed");
    expect(resetButton).toHaveClass("border-transparent");
    fireEvent.click(resetButton);
    expect(onColorSelect).toHaveBeenCalledWith(undefined);
  });

  it("emits selected color when swatch is clicked", () => {
    const onColorSelect = vi.fn();
    render(
      <ColorPalette
        isOpen
        position={defaultPosition}
        onColorSelect={onColorSelect}
        onClose={vi.fn()}
      />
    );

    const swatch = document.querySelector(
      'button[title="yellow"]'
    ) as HTMLButtonElement;
    fireEvent.click(swatch);
    expect(onColorSelect).toHaveBeenCalledWith("#eab308");
  });

  it("prevents pointer events from bubbling to parents", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <ColorPalette
          isOpen
          position={defaultPosition}
          onColorSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    const container = document.querySelector(
      "div.nodrag"
    ) as HTMLDivElement;
    fireEvent.click(container);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
