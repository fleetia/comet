import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatGptSettings, type ChatgptStatus } from "../components/ChatGptSettings/ChatGptSettings";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const disconnected: ChatgptStatus = {
  accounts: [],
  activeAccountId: null,
  loginPending: false,
  usageUrl: "https://chatgpt.com/settings/usage",
  notice: null,
};
const connected: ChatgptStatus = {
  ...disconnected,
  activeAccountId: "account-1",
  accounts: [{ id: "account-1", label: "계정 1", email: null, connected: true, sharing: true }],
};
beforeEach(() => vi.mocked(command).mockReset());
function Settings({ savedModel = "" }: { savedModel?: string }): React.JSX.Element {
  const savedSettings = useMemo(
    () => ({ ...PREVIEW_SNAPSHOT.settings, mode: "chatgpt" as const, chatgptModel: savedModel }),
    [savedModel],
  );
  const draft = useSettingsDraft(savedSettings, "model");
  return (
    <ChatGptSettings
      draft={draft}
      footer={<button onClick={() => void draft.run("save_settings")}>연결 저장</button>}
    />
  );
}

it("requires consent and lets cancellation finish before a late login result", async () => {
  let finishLogin!: (value: ChatgptStatus) => void;
  vi.mocked(command).mockImplementation(async (name) =>
    name === "login_chatgpt"
      ? new Promise<ChatgptStatus>((resolve) => {
          finishLogin = resolve;
        })
      : disconnected,
  );
  render(<Settings />);
  const login = await screen.findByRole("button", { name: "ChatGPT로 로그인" });
  expect(login).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /동의해요/ }));
  fireEvent.click(login);
  expect(command).toHaveBeenCalledWith("login_chatgpt", { consent: true });
  fireEvent.click(await screen.findByRole("button", { name: "로그인 취소" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("cancel_chatgpt_login", undefined));
  await act(async () => finishLogin(connected));
  expect(screen.queryByText("연결됨")).toBeNull();
  expect(screen.queryByRole("button", { name: "로그인 취소" })).toBeNull();
});

it("does not silently replace an unavailable saved model and preserves other provider drafts", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_chatgpt_status"
      ? connected
      : name === "list_chatgpt_models"
        ? [{ slug: "available", displayName: "사용 가능 모델" }]
        : undefined,
  );
  render(<Settings savedModel="unavailable" />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("다시 선택"),
  );
  expect(screen.getByLabelText("ChatGPT 모델")).toHaveProperty("value", "unavailable");
  fireEvent.change(screen.getByLabelText("ChatGPT 모델"), { target: { value: "available" } });
  fireEvent.click(screen.getByRole("button", { name: "연결 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_settings", {
      scope: "model",
      apiKey: null,
      settings: { ...PREVIEW_SNAPSHOT.settings, mode: "chatgpt", chatgptModel: "available" },
    }),
  );
});

it("waits for explicit catalog retry after a model-list failure", async () => {
  vi.useFakeTimers();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "list_chatgpt_models") throw new Error("목록을 가져오지 못했어요.");
    return connected;
  });
  await act(async () => {
    render(<Settings />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  const modelCalls = () =>
    vi.mocked(command).mock.calls.filter(([name]) => name === "list_chatgpt_models");
  expect(modelCalls()).toHaveLength(1);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "모델 목록 다시 불러오기" }));
  });
  expect(modelCalls()).toHaveLength(2);
});

it("separates login from plan permission and does not load or enable models without sharing", async () => {
  vi.mocked(command).mockResolvedValue({
    ...connected,
    accounts: connected.accounts.map((account) => ({ ...account, sharing: false })),
  });
  render(<Settings savedModel="saved-model" />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("플랜을 사용할 권한이 없어요"),
  );
  expect(screen.getByLabelText("ChatGPT 모델")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("ChatGPT 모델")).toHaveProperty("value", "saved-model");
  expect(screen.getByRole("button", { name: "선택한 계정 다시 연결" })).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("list_chatgpt_models");
  expect(command).not.toHaveBeenCalledWith("save_settings", expect.anything());
});

it("keeps the saved model visible but unverified when a catalog refresh fails", async () => {
  let modelRequests = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name !== "list_chatgpt_models") {
      return connected;
    }
    modelRequests += 1;
    if (modelRequests > 1) {
      throw new Error("모델 목록 확인 실패");
    }
    return [{ slug: "saved-model", displayName: "저장한 모델" }];
  });
  render(<Settings savedModel="saved-model" />);
  await waitFor(() =>
    expect(screen.getByLabelText("ChatGPT 모델")).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "모델 목록 다시 불러오기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "모델 목록 확인 실패");
  expect(screen.getByLabelText("ChatGPT 모델")).toHaveProperty("value", "saved-model");
  expect(screen.getByLabelText("ChatGPT 모델")).toHaveProperty("disabled", true);
  expect(screen.getByText("플랜 권한 있음 · 모델 확인 필요")).toBeTruthy();
});

it("locks each Figma draft scope while its save is pending", async () => {
  let finish!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_chatgpt_status") return connected;
    if (name === "list_chatgpt_models")
      return [
        { slug: "one", displayName: "하나" },
        { slug: "two", displayName: "둘" },
      ];
    if (name === "save_settings")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  function FigmaSettings(): React.JSX.Element {
    const saved = useMemo(
      () => ({ ...PREVIEW_SNAPSHOT.settings, mode: "chatgpt" as const, chatgptModel: "one" }),
      [],
    );
    const model = useSettingsDraft(saved, "model");
    const automatic = useSettingsDraft(saved, "automatic");
    return (
      <ChatGptSettings
        draft={model}
        automaticDraft={automatic}
        inspectorHeader={<h1>AI</h1>}
        footer={<button onClick={() => void model.run("save_settings")}>모델 저장</button>}
        automaticFooter={
          <button onClick={() => void automatic.run("save_settings")}>자동 저장</button>
        }
      />
    );
  }
  render(<FigmaSettings />);
  const model = await screen.findByRole("combobox", { name: "ChatGPT 모델" });
  await waitFor(() => expect(model).toHaveProperty("disabled", false));
  fireEvent.change(model, { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "모델 저장" }));
  await waitFor(() => expect(model).toHaveProperty("disabled", true));
  await act(async () => finish());
  await waitFor(() => expect(model).toHaveProperty("disabled", false));
  const automatic = screen.getByRole("switch", { name: "ChatGPT로 새 잡담 만들기" });
  fireEvent.click(automatic);
  fireEvent.click(screen.getByRole("button", { name: "자동 저장" }));
  await waitFor(() => expect(automatic).toHaveProperty("disabled", true));
  expect(model).toHaveProperty("disabled", false);
  await act(async () => finish());
  await waitFor(() => expect(automatic).toHaveProperty("disabled", false));
});
