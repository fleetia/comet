import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TalkPackPanel } from "../components/TalkPackPanel/TalkPackPanel";
import { SettingsPanel } from "../components/SettingsPanel/SettingsPanel";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";
import type { TalkPack } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);

const INSTALLED: TalkPack[] = [
  {
    id: "byulkkori",
    name: "별꼬리 기본 대화",
    description: "기본 대화",
    installed: true,
    bundled: true,
    defaultInstalled: true,
  },
  {
    id: "nadir-and-star-tail",
    name: "나디르와 별꼬리",
    description: "추가팩 대화",
    installed: false,
    bundled: true,
    defaultInstalled: false,
  },
];
const REMOVED: TalkPack[] = INSTALLED.map((pack) =>
  pack.id === "byulkkori" ? { ...pack, installed: false } : pack,
);

beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_talk_packs") return INSTALLED;
    if (name === "remove_talk_pack") return REMOVED;
    if (name === "install_talk_pack") return INSTALLED;
    return undefined;
  });
});

it("lists bundled packs and removes the default pack without reinstalling it", async () => {
  render(<TalkPackPanel />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_talk_packs"));
  expect(await screen.findByText("별꼬리 기본 대화")).toBeTruthy();
  expect(screen.getByRole("button", { name: "나디르와 별꼬리 설치" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "별꼬리 기본 대화 제거" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("remove_talk_pack", { id: "byulkkori" }),
  );
  expect(await screen.findByRole("button", { name: "별꼬리 기본 대화 설치" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("되살리지 않아요");
  fireEvent.click(screen.getByRole("button", { name: "나디르와 별꼬리 설치" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("install_talk_pack", { id: "nadir-and-star-tail" }),
  );
});

it("shows the command error instead of changing the list", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_talk_packs") return INSTALLED;
    throw new Error("이미 설치된 대화팩이에요.");
  });
  render(<TalkPackPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "나디르와 별꼬리 설치" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "이미 설치된 대화팩이에요.",
  );
  expect(screen.getByRole("button", { name: "나디르와 별꼬리 설치" })).toBeTruthy();
});

it("opens the pack list from the settings tab", async () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} />);
  fireEvent.click(screen.getByRole("tab", { name: "대화팩" }));
  expect(await screen.findByRole("list", { name: "대화팩 목록" })).toBeTruthy();
});
