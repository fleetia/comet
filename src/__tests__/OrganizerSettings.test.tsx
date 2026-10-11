import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrganizerSettings } from "../components/OrganizerSettings/OrganizerSettings";
import { command } from "../hooks/useSnapshot";
import { PREVIEW_ORGANIZER_STATUS } from "../organizer/types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);
beforeEach(() =>
  vi
    .mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "organizer_status" ? PREVIEW_ORGANIZER_STATUS : undefined,
    ),
);

it("keeps Vault and model saves separate from the automatic organizer draft", async () => {
  const dirty = vi.fn();
  render(<OrganizerSettings onDirtyChange={dirty} />);
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(screen.getByRole("checkbox", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
    "checked",
    false,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "유휴 시간에 자동 정리" }));
  fireEvent.click(screen.getByText("Vault 연결", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("Vault 폴더"), { target: { value: "/my/vault" } });
  fireEvent.click(screen.getByRole("button", { name: "Ex-brain 설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("organizer_save_settings", {
      settings: { enabled: true, cometEnabled: false, idleSeconds: 300, dailyRequestLimit: 20 },
    }),
  );
  expect(command).not.toHaveBeenCalledWith("save_settings", expect.anything());
  expect(command).not.toHaveBeenCalledWith("organizer_connect_vault", expect.anything());
  expect(screen.getByLabelText("Vault 폴더")).toHaveProperty("value", "/my/vault");
  expect(dirty).toHaveBeenLastCalledWith(true);
});

it("keeps a failed connection draft intact and does not enable automatic Vault processing implicitly", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "organizer_connect_vault") throw new Error("접근할 수 없는 폴더예요.");
    return PREVIEW_ORGANIZER_STATUS;
  });
  render(<OrganizerSettings />);
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByText("Vault 연결", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("Vault 폴더"), { target: { value: "/my/vault" } });
  fireEvent.click(screen.getByRole("button", { name: "Vault 연결" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "접근할 수 없는 폴더예요.",
  );
  expect(screen.getByLabelText("Vault 폴더")).toHaveProperty("value", "/my/vault");
  expect(command).toHaveBeenCalledWith("organizer_connect_vault", {
    connection: expect.objectContaining({
      root: "/my/vault",
      automatic: false,
      outputDir: "comet-ex-brain",
      exclude: expect.arrayContaining(["03.diary", "99.deprecated"]),
    }),
  });
});
