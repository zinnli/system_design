import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useDragDropFiles from "./useDragDropFiles";

function TestDropzone({ onFilesDrop }: { onFilesDrop: (files: File[]) => void }) {
  const { dragRef, isDragging } = useDragDropFiles({ onFilesDrop });
  return <div ref={dragRef} data-testid="zone" data-dragging={isDragging} />;
}

function makeFile(name: string): File {
  return new File([new Uint8Array(10)], name);
}

describe("useDragDropFiles", () => {
  it("dragenter 시 isDragging이 켜지고, 영역을 벗어나면 꺼진다", () => {
    render(<TestDropzone onFilesDrop={vi.fn()} />);
    const zone = screen.getByTestId("zone");

    fireEvent.dragEnter(zone);
    expect(zone.dataset.dragging).toBe("true");

    fireEvent.dragLeave(zone);
    expect(zone.dataset.dragging).toBe("false");
  });

  it("파일을 드롭하면 전체 파일 목록이 콜백으로 전달되고 하이라이트가 꺼진다", () => {
    const onFilesDrop = vi.fn();
    render(<TestDropzone onFilesDrop={onFilesDrop} />);
    const zone = screen.getByTestId("zone");

    fireEvent.dragEnter(zone);
    fireEvent.drop(zone, {
      dataTransfer: { files: [makeFile("a.txt"), makeFile("b.txt")] },
    });

    expect(onFilesDrop).toHaveBeenCalledTimes(1);
    expect(onFilesDrop.mock.calls[0]![0].map((f: File) => f.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);
    expect(zone.dataset.dragging).toBe("false");
  });

  it("파일 없이 드롭되면 콜백을 호출하지 않는다", () => {
    const onFilesDrop = vi.fn();
    render(<TestDropzone onFilesDrop={onFilesDrop} />);
    const zone = screen.getByTestId("zone");

    fireEvent.drop(zone, { dataTransfer: { files: [] } });

    expect(onFilesDrop).not.toHaveBeenCalled();
  });
});
