import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  disconnectReason: null,
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

it("shows the disconnected card and requires consent to connect", async () => {
  vi.mocked(command).mockResolvedValue(disconnected);
  render(<Settings />);
  expect(await screen.findByText("연결 필요")).toBeTruthy();
  expect(
    screen.getByText(
      "ChatGPT는 Plus·Pro 플랜에서만 쓸 수 있어요. 무료 계정이면 이 기기의 모델을 써요.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /동의해요/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "ChatGPT로 연결" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "연결 끊기" })).toBeNull();
  expect(screen.queryByLabelText("ChatGPT 계정")).toBeNull();
});

it("shows the connecting card while the browser login is pending", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "list_chatgpt_models" ? [] : { ...connected, loginPending: true },
  );
  render(<Settings />);
  expect(await screen.findByText("브라우저에서 연결 중")).toBeTruthy();
  expect(screen.getByText("브라우저에서 연결을 마치면 이 화면으로 돌아와요.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "취소" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /동의해요/ })).toBeNull();
});

it("shows the connected card with account actions", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "list_chatgpt_models" ? [] : connected,
  );
  render(<Settings />);
  expect(await screen.findByText("계정 1")).toBeTruthy();
  expect(screen.getByText("연결됨")).toBeTruthy();
  expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "다른 계정으로 바꾸기" })).toBeTruthy();
  expect(
    screen.getByText("연결 정보는 이 기기의 보안 저장소에만 두고 화면이나 기록에 남기지 않아요."),
  ).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /동의해요/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "계정 추가…" })).toBeNull();
});

it("shows the connected card without plan access", async () => {
  vi.mocked(command).mockResolvedValue({
    ...connected,
    accounts: connected.accounts.map((account) => ({ ...account, sharing: false })),
  });
  render(<Settings />);
  expect(
    await screen.findByText("연결됨 · 이 계정은 플랜을 쓸 수 없어요 (Plus·Pro만)"),
  ).toBeTruthy();
  expect(screen.getByText("무료 계정이면 이 기기의 모델을 써요.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "다른 계정으로 바꾸기" })).toBeTruthy();
});

it("allows disconnecting an account after its connection is lost", async () => {
  const lost = {
    ...connected,
    accounts: connected.accounts.map((account) => ({ ...account, connected: false })),
    notice: "ChatGPT 자격 증명 저장소를 읽거나 저장하지 못했어요. 기존 정보는 보존했어요.",
  };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "logout_chatgpt" ? disconnected : lost,
  );
  render(<Settings />);
  expect(await screen.findByText("연결이 끊겼어요")).toBeTruthy();
  expect(screen.getByText("끊긴 계정도 여기서 바로 지울 수 있어요.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "다시 연결" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "연결 끊기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("logout_chatgpt", { accountId: "account-1" }),
  );
});

for (const [disconnectReason, label] of [
  ["save_failed", "연결 정보를 저장하지 못했어요"],
  ["expired", "연결 정보가 만료됐어요"],
] as const) {
  it(`shows the ${disconnectReason} reason independently of the notice`, async () => {
    vi.mocked(command).mockResolvedValue({
      ...connected,
      accounts: connected.accounts.map((account) => ({ ...account, connected: false })),
      disconnectReason,
      notice: null,
    });
    render(<Settings />);
    expect(await screen.findByText(`연결이 끊겼어요 · ${label}`)).toBeTruthy();
  });
}

it("deletes another account from the collapsed list when the active connection is lost", async () => {
  const multiple: ChatgptStatus = {
    ...connected,
    accounts: [
      { ...connected.accounts[0], connected: false },
      { id: "account-2", label: "계정 2", email: null, connected: true, sharing: true },
    ],
  };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "list_chatgpt_models" ? [] : multiple,
  );
  render(<Settings />);
  fireEvent.click(await screen.findByText("다른 계정 1개"));
  expect(screen.getByText("계정 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "이 계정으로" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("logout_chatgpt", { accountId: "account-2" }),
  );
});

it("offers disconnect while connecting without an active account", async () => {
  vi.mocked(command).mockResolvedValue({ ...disconnected, loginPending: true });
  render(<Settings />);
  expect(await screen.findByText("브라우저에서 연결 중")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "연결 끊기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("cancel_chatgpt_login", undefined));
});

for (const shouldDelete of [false, true]) {
  it(`asks once about the previous account after switching and ${shouldDelete ? "deletes" : "keeps"} it`, async () => {
    let current = connected;
    const next: ChatgptStatus = {
      ...connected,
      activeAccountId: "account-2",
      accounts: [
        ...connected.accounts,
        { id: "account-2", label: "계정 2", email: null, connected: true, sharing: true },
      ],
    };
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "list_chatgpt_models") return [];
      if (name === "login_chatgpt") current = next;
      if (name === "logout_chatgpt") current = { ...next, accounts: [next.accounts[1]] };
      return current;
    });
    render(<Settings />);
    fireEvent.click(await screen.findByRole("button", { name: "다른 계정으로 바꾸기" }));
    expect(await screen.findByRole("dialog", { name: "이전 계정을 지울까요?" })).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "이전 계정을 지울까요?" })).getByRole("button", {
        name: shouldDelete ? "지우기" : "남기기",
      }),
    );
    if (shouldDelete) {
      await waitFor(() =>
        expect(command).toHaveBeenCalledWith("logout_chatgpt", { accountId: "account-1" }),
      );
    } else {
      expect(command).not.toHaveBeenCalledWith("logout_chatgpt", expect.anything());
      expect(await screen.findByText("다른 계정 1개")).toBeTruthy();
    }
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "이전 계정을 지울까요?" })).toBeNull(),
    );
  });
}

it("does not ask to delete the previous account when reconnecting the same account", async () => {
  const lost: ChatgptStatus = {
    ...connected,
    accounts: connected.accounts.map((account) => ({ ...account, connected: false })),
  };
  let current = lost;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "list_chatgpt_models") return [];
    if (name === "login_chatgpt") current = connected;
    return current;
  });
  render(<Settings />);
  fireEvent.click(await screen.findByRole("button", { name: "다시 연결" }));
  expect(await screen.findByText("연결됨")).toBeTruthy();
  expect(command).toHaveBeenCalledWith("login_chatgpt", { accountId: "account-1", consent: true });
  expect(screen.queryByRole("dialog", { name: "이전 계정을 지울까요?" })).toBeNull();
});

it("does not ask to delete a lost account removed after reconnecting as another account", async () => {
  const lost: ChatgptStatus = {
    ...connected,
    accounts: connected.accounts.map((account) => ({ ...account, connected: false })),
  };
  const next: ChatgptStatus = {
    ...connected,
    activeAccountId: "account-2",
    accounts: [{ id: "account-2", label: "계정 2", email: null, connected: true, sharing: true }],
  };
  let current = lost;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "list_chatgpt_models") return [];
    if (name === "login_chatgpt") current = next;
    return current;
  });
  render(<Settings />);
  fireEvent.click(await screen.findByRole("button", { name: "다시 연결" }));
  expect(await screen.findByText("계정 2")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "이전 계정을 지울까요?" })).toBeNull();
});

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
  const login = await screen.findByRole("button", { name: "ChatGPT로 연결" });
  expect(login).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /동의해요/ }));
  fireEvent.click(login);
  expect(command).toHaveBeenCalledWith("login_chatgpt", { consent: true });
  fireEvent.click(await screen.findByRole("button", { name: "취소" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("cancel_chatgpt_login", undefined));
  await act(async () => finishLogin(connected));
  expect(screen.queryByText("연결됨")).toBeNull();
  expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
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
  expect(screen.getByRole("button", { name: "다른 계정으로 바꾸기" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy();
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
