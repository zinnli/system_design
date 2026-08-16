import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

// 네트워크 계층(axios)은 uploadApi 모듈 mock으로 대체한다.
vi.mock("./utils/uploadApi", () => ({
  initUpload: vi.fn(async () => ({ uploadId: "u1" })),
  uploadChunk: vi.fn(async () => {}),
  completeUpload: vi.fn(async () => {}),
}));

describe("App", () => {
  it("파일을 선택하면 업로드가 진행되어 완료 상태로 표시된다", async () => {
    const { container } = render(<App />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File([new Uint8Array(100)], "photo.png");

    await userEvent.upload(input, file);

    expect(await screen.findByText("photo.png")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("완료")).toBeInTheDocument();
    });
  });

  it("검증에 실패한 파일은 에러 메시지로 안내하고 목록에 넣지 않는다", async () => {
    const { container } = render(<App />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const emptyFile = new File([], "empty.png");

    await userEvent.upload(input, emptyFile);

    expect(await screen.findByText(/빈 파일/)).toBeInTheDocument();
    expect(container.querySelector(".file-list")).not.toBeInTheDocument();
  });
});
