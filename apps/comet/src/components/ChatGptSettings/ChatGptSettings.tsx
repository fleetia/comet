import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  FormField,
  Select,
  SettingControlRow,
  Surface,
  Switch,
} from "@comet/ui";
import { UserIcon } from "@comet/icon";
import * as figma from "../SettingsPanel/figmaSettings.css";
import * as ai from "../ModelSettings/aiSettings.css";
import type { SettingsDraft } from "../../hooks/useSettingsDraft";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as styles from "../ModelSettings/modelSettings.css";
import * as s from "../../common.css";

export type ChatgptStatus = {
  accounts: {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
  }[];
  activeAccountId: string | null;
  loginPending: boolean;
  usageUrl: string;
  notice: string | null;
  disconnectReason: "save_failed" | "expired" | null;
  requestBlocked?: boolean;
};
export type ChatgptModel = { slug: string; displayName: string };
const PREVIEW: ChatgptStatus = {
  accounts: [],
  activeAccountId: null,
  loginPending: false,
  usageUrl: "https://chatgpt.com/settings/usage",
  notice: null,
  disconnectReason: null,
};

export function ChatGptSettings({
  draft,
  footer,
  inspectorHeader,
  supportingContent,
  automaticDraft,
  automaticFooter,
}: {
  draft: SettingsDraft;
  footer?: ReactNode;
  inspectorHeader?: ReactNode;
  supportingContent?: ReactNode;
  automaticDraft?: SettingsDraft;
  automaticFooter?: ReactNode;
}): JSX.Element {
  const [status, setStatus] = useState<ChatgptStatus | null>(isDesktop() ? null : PREVIEW);
  const [models, setModels] = useState<ChatgptModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previousAccountId, setPreviousAccountId] = useState<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const loading = useRef(false);
  const modelAccount = useRef<string | null>(null);
  const selection = useRef(draft.settings.chatgptModel);
  selection.current = draft.settings.chatgptModel;
  const change = useRef(draft.change);
  change.current = draft.change;
  async function refresh(): Promise<void> {
    if (loading.current) return;
    loading.current = true;
    const version = operation.current;
    try {
      const next = await command<ChatgptStatus>("get_chatgpt_status");
      if (!mounted.current || version !== operation.current || !next) return;
      setStatus(next);
      const account = next.accounts.find((value) => value.id === next.activeAccountId);
      if (!account?.connected || !account.sharing) {
        modelAccount.current = null;
        setModels([]);
        setModelsLoaded(false);
      } else if (modelAccount.current !== account.id) {
        // A failed catalog request waits for explicit retry instead of every status poll.
        modelAccount.current = account.id;
        setModels([]);
        setModelsLoaded(false);
        const values = await command<ChatgptModel[]>("list_chatgpt_models");
        if (!mounted.current || version !== operation.current) return;
        setModels(values);
        setModelsLoaded(true);
        if (!selection.current && values[0]) change.current("chatgptModel", values[0].slug);
      }
    } catch (cause) {
      if (mounted.current && version === operation.current) setError(errorText(cause));
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (!isDesktop()) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    return () => {
      mounted.current = false;
      operation.current += 1;
      clearInterval(timer);
    };
  }, []);
  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (
      pending &&
      !(pending === "login_chatgpt" && ["cancel_chatgpt_login", "logout_chatgpt"].includes(name))
    )
      return;
    const oldAccountId = name === "login_chatgpt" ? status?.activeAccountId : null;
    const version = ++operation.current;
    setPending(name);
    setError(null);
    try {
      const result = await command<ChatgptStatus | undefined>(name, args);
      if (mounted.current && version === operation.current) {
        if (result?.accounts) {
          setStatus(result);
          if (
            oldAccountId &&
            result.activeAccountId &&
            result.activeAccountId !== oldAccountId &&
            result.accounts.some((value) => value.id === oldAccountId)
          ) {
            setPreviousAccountId(oldAccountId);
          }
        }
        modelAccount.current = null;
        await refresh();
      }
    } catch (cause) {
      if (mounted.current && version === operation.current) setError(errorText(cause));
    } finally {
      if (mounted.current && version === operation.current) setPending(null);
    }
  }
  const account = status?.accounts.find((value) => value.id === status.activeAccountId);
  const hasPlanAccess = Boolean(account?.connected && account.sharing);
  const loginPending = status?.loginPending || pending === "login_chatgpt";
  const busy = Boolean(pending || loginPending || draft.pending || !isDesktop());
  const selectedModelAbsent =
    Boolean(draft.settings.chatgptModel) &&
    !models.some((model) => model.slug === draft.settings.chatgptModel);
  const missingModel = modelsLoaded && selectedModelAbsent;
  const otherAccounts =
    status?.accounts.filter((value) => value.id !== account?.id && value.connected) ?? [];
  const canInterruptLogin = !pending || pending === "login_chatgpt";
  const disconnectedReason = status?.disconnectReason
    ? {
        save_failed: "연결 정보를 저장하지 못했어요",
        expired: "연결 정보가 만료됐어요",
      }[status.disconnectReason]
    : null;
  const cardState = loginPending
    ? "connecting"
    : !account
      ? "disconnected"
      : !account.connected
        ? "lost"
        : !account.sharing
          ? "no-plan"
          : "connected";
  const cardStatus = {
    disconnected: "연결 필요",
    connecting: "브라우저에서 연결 중",
    connected: "연결됨",
    "no-plan": "연결됨 · 이 계정은 플랜을 쓸 수 없어요 (Plus·Pro만)",
    lost: `연결이 끊겼어요${disconnectedReason ? ` · ${disconnectedReason}` : ""}`,
  }[cardState];
  const cardNotice = {
    disconnected:
      "ChatGPT는 Plus·Pro 플랜에서만 쓸 수 있어요. 무료 계정이면 이 기기의 모델을 써요.",
    connecting: "브라우저에서 연결을 마치면 이 화면으로 돌아와요.",
    connected: "연결 정보는 이 기기의 보안 저장소에만 두고 화면이나 기록에 남기지 않아요.",
    "no-plan": "무료 계정이면 이 기기의 모델을 써요.",
    lost: "끊긴 계정도 여기서 바로 지울 수 있어요.",
  }[cardState];
  const connectionCard = (
    <>
      <div className={ai.connectionStatus}>
        <div className={ai.accountHeader}>
          <span className={figma.icon}>
            <UserIcon size={26} />
          </span>
          <div className={figma.noteCopy}>
            <strong className={ai.accountLabel}>{account?.label || "ChatGPT"}</strong>
            <span className={figma.caption}>{cardStatus}</span>
          </div>
        </div>
      </div>
      {cardState === "disconnected" && (
        <Checkbox
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
          label="대화와 고른 자료를 ChatGPT로 보내는 데 동의해요"
        />
      )}
      <div className={ai.keyActions}>
        {cardState === "disconnected" && (
          <Button
            variant="primary"
            size="small"
            disabled={busy || !consent}
            onClick={() => void run("login_chatgpt", { consent: true })}
          >
            ChatGPT로 연결
          </Button>
        )}
        {cardState === "connecting" && (
          <Button
            variant="ghost"
            size="small"
            disabled={!canInterruptLogin}
            onClick={() => void run("cancel_chatgpt_login")}
          >
            취소
          </Button>
        )}
        {cardState === "lost" && account && (
          <Button
            variant="primary"
            size="small"
            disabled={busy}
            onClick={() => void run("login_chatgpt", { accountId: account.id, consent: true })}
          >
            다시 연결
          </Button>
        )}
        {cardState !== "disconnected" && (
          <Button
            variant="ghost"
            size="small"
            disabled={!isDesktop() || !canInterruptLogin || Boolean(draft.pending)}
            onClick={() => {
              if (account) void run("logout_chatgpt", { accountId: account.id });
              else void run("cancel_chatgpt_login");
            }}
          >
            연결 끊기
          </Button>
        )}
        {(cardState === "connected" || cardState === "no-plan") && (
          <Button
            variant="ghost"
            size="small"
            disabled={busy}
            onClick={() => void run("login_chatgpt", { consent: true })}
          >
            다른 계정으로 바꾸기
          </Button>
        )}
      </div>
      {otherAccounts.length > 0 && (
        <details>
          <summary className={figma.caption}>다른 계정 {otherAccounts.length}개</summary>
          {otherAccounts.map((value) => (
            <div key={value.id} className={ai.keyActions}>
              <span className={ai.accountLabel}>{value.label}</span>
              <Button
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => void run("select_chatgpt_account", { accountId: value.id })}
              >
                이 계정으로
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={!isDesktop() || !canInterruptLogin || Boolean(draft.pending)}
                onClick={() => void run("logout_chatgpt", { accountId: value.id })}
              >
                지우기
              </Button>
            </div>
          ))}
        </details>
      )}
      <p className={figma.caption}>{cardNotice}</p>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {status?.notice && status.notice !== error && pending !== "login_chatgpt" && (
        <p role="status" className={figma.caption}>
          {status.notice}
        </p>
      )}
      {!status && !error && <p role="status">연결 상태를 확인하고 있어요.</p>}
      <Dialog
        isOpen={previousAccountId !== null}
        title="이전 계정을 지울까요?"
        variant="confirm"
        onOpenChange={(open) => {
          if (!open) setPreviousAccountId(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreviousAccountId(null)}>
              남기기
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (previousAccountId) void run("logout_chatgpt", { accountId: previousAccountId });
                setPreviousAccountId(null);
              }}
            >
              지우기
            </Button>
          </>
        }
      >
        <p>남겨 두면 다른 계정 목록에서 다시 선택할 수 있어요.</p>
      </Dialog>
    </>
  );
  let requestState = "플랜 권한 있음 · 모델 확인 필요";
  if (!account?.connected) {
    requestState = "ChatGPT 연결 필요";
  } else if (!account.sharing) {
    requestState = "연결됨 · 이 계정은 플랜을 쓸 수 없어요";
  } else if (status?.requestBlocked) {
    requestState = "요청 중단 · 사용량 또는 권한 확인 필요";
  } else if (missingModel) {
    requestState = "선택 모델 사용 불가";
  } else if (modelsLoaded && models.length > 0) {
    requestState = "플랜 권한과 모델 확인됨 · 실제 요청은 사용량에 따라 달라져요";
  }
  if (inspectorHeader)
    return (
      <div className={figma.split}>
        <aside className={figma.inspector}>
          {inspectorHeader}
          {connectionCard}
        </aside>
        <div className={figma.right}>
          <section className={figma.section}>
            <h2 className={figma.sectionTitle}>모델</h2>
            <div className={figma.group}>
              <SettingControlRow
                className={figma.row}
                title="현재 사용 상태"
                description={requestState}
                control={null}
              />
              <SettingControlRow
                className={figma.row}
                title="ChatGPT 모델"
                description="계정에서 쓸 수 있는 모델 중에서 골라요"
                control={
                  <Select
                    aria-label="ChatGPT 모델"
                    value={draft.settings.chatgptModel}
                    disabled={!hasPlanAccess || busy || !models.length}
                    onChange={(event) => draft.change("chatgptModel", event.target.value)}
                  >
                    {!draft.settings.chatgptModel && <option value="">계정의 기본 모델</option>}
                    {selectedModelAbsent && (
                      <option value={draft.settings.chatgptModel}>
                        {draft.settings.chatgptModel} ·{" "}
                        {modelsLoaded ? "사용할 수 없음" : "확인 전"}
                      </option>
                    )}
                    {models.map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.displayName}
                      </option>
                    ))}
                  </Select>
                }
              />
              <SettingControlRow
                className={figma.row}
                title="모델 목록"
                description="마지막으로 불러온 목록을 써요"
                control={
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy || !hasPlanAccess}
                    onClick={() => {
                      modelAccount.current = null;
                      setError(null);
                      void refresh();
                    }}
                  >
                    다시 불러오기
                  </Button>
                }
              />
              <SettingControlRow
                className={figma.row}
                title="플랜과 사용량"
                description="사용량이 모자라면 다른 결제로 넘어가지 않고 알려 줘요"
                control={
                  <Button
                    variant="link"
                    size="small"
                    disabled={!isDesktop()}
                    onClick={() => void run("open_chatgpt_usage")}
                  >
                    ChatGPT에서 확인 ↗
                  </Button>
                }
              />
            </div>
            {account?.connected && !account.sharing && (
              <p role="alert" className={s.error}>
                연결은 완료됐지만 Comet에서 ChatGPT 플랜을 사용할 권한이 없어요. 전송 안내에 동의한
                뒤 다시 연결하거나 다른 AI를 선택해 주세요.
              </p>
            )}
            {missingModel && (
              <p role="alert" className={s.error}>
                저장한 모델을 이 계정에서 사용할 수 없어요. 사용할 모델을 다시 선택해 주세요.
              </p>
            )}
            {status?.requestBlocked && account && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run("select_chatgpt_account", { accountId: account.id })}
              >
                사용량 확인 후 다시 시도
              </Button>
            )}
          </section>
          {automaticDraft && (
            <section className={figma.section}>
              <h2 className={figma.sectionTitle}>자동 잡담</h2>
              <div className={figma.group}>
                <SettingControlRow
                  className={figma.row}
                  title="ChatGPT로 새 잡담 만들기"
                  description="플랜 사용량을 써요 · 설정 → 대화에서도 바꿀 수 있어요"
                  control={
                    <Switch
                      aria-label="ChatGPT로 새 잡담 만들기"
                      checked={automaticDraft.settings.chatgptIdleEnabled}
                      disabled={Boolean(automaticDraft.pending)}
                      onChange={(event) =>
                        automaticDraft.change("chatgptIdleEnabled", event.target.checked)
                      }
                    />
                  }
                />
              </div>
              {automaticDraft.hasChanges && automaticFooter}
            </section>
          )}
          {supportingContent}
          {footer}
        </div>
      </div>
    );
  return (
    <Surface variant="panel" className={styles.connectionPanel} aria-label="ChatGPT 연결">
      <div className={styles.body}>
        {connectionCard}
        <p className={styles.caption}>{requestState}</p>
        {account?.connected && !account.sharing && (
          <p role="alert" className={s.error}>
            연결은 완료됐지만 Comet에서 ChatGPT 플랜을 사용할 권한이 없어요. 전송 안내에 동의한 뒤
            다시 연결하거나 다른 AI를 선택해 주세요.
          </p>
        )}
        <FormField label="ChatGPT 모델" className={styles.field}>
          <Select
            fill
            value={draft.settings.chatgptModel}
            disabled={!hasPlanAccess || busy || models.length === 0}
            onChange={(event) => draft.change("chatgptModel", event.target.value)}
          >
            {!draft.settings.chatgptModel && <option value="">연결 후 모델 선택</option>}
            {selectedModelAbsent && (
              <option value={draft.settings.chatgptModel}>
                {draft.settings.chatgptModel} · {modelsLoaded ? "사용할 수 없음" : "확인 전"}
              </option>
            )}
            {models.map((model) => (
              <option key={model.slug} value={model.slug}>
                {model.displayName}
              </option>
            ))}
          </Select>
        </FormField>
        {missingModel && (
          <p role="alert" className={s.error}>
            저장한 모델을 이 계정에서 사용할 수 없어요. 사용할 모델을 다시 선택해 주세요.
          </p>
        )}
        {hasPlanAccess && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              modelAccount.current = null;
              setError(null);
              void refresh();
            }}
          >
            모델 목록 다시 불러오기
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={!isDesktop()}
          onClick={() => void run("open_chatgpt_usage")}
        >
          ChatGPT 플랜·사용량 확인 ↗
        </Button>
        {status?.requestBlocked && account && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run("select_chatgpt_account", { accountId: account.id })}
          >
            사용량 확인 후 다시 시도
          </Button>
        )}
        <p className={styles.caption}>
          계정 연결은 즉시 적용돼요. 대화 방식과 모델 선택은 아래 AI 연결 저장으로 적용해요. 자동
          잡담은 자동 대화에서 별도로 허용할 수 있어요.
        </p>
      </div>
      {footer}
    </Surface>
  );
}
