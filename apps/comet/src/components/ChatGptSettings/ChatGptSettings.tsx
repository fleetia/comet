import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { Button, Checkbox, FormField, Select, SettingControlRow, Surface, Switch } from "@comet/ui";
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
  requestBlocked?: boolean;
};
export type ChatgptModel = { slug: string; displayName: string };
const PREVIEW: ChatgptStatus = {
  accounts: [],
  activeAccountId: null,
  loginPending: false,
  usageUrl: "https://chatgpt.com/settings/usage",
  notice: null,
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
    if (pending && name !== "cancel_chatgpt_login") return;
    const version = ++operation.current;
    setPending(name);
    setError(null);
    try {
      const result = await command<ChatgptStatus | undefined>(name, args);
      if (mounted.current && version === operation.current) {
        if (result?.accounts) setStatus(result);
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
  const connectionFailure = ["ChatGPT 연결을 마치지 못했어요.", "연결 대기 시간이 끝났어요."].includes(
    error || status?.notice || "",
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
          <div className={ai.connectionStatus}>
            <div className={ai.accountHeader}>
              <span className={figma.icon}>
                <UserIcon size={26} />
              </span>
              <div className={figma.noteCopy}>
                <strong className={ai.accountLabel}>{account?.label || "내 ChatGPT 계정"}</strong>
                <span className={figma.caption}>
                  {loginPending
                    ? "브라우저에서 연결 중"
                    : account?.connected
                      ? account.sharing
                        ? `연결됨 · 계정 ${status?.accounts.length || 0}개`
                        : "연결됨 · 이 계정은 플랜을 쓸 수 없어요"
                      : "ChatGPT 연결 필요"}
                </span>
              </div>
            </div>
            {!!status?.accounts.length && (
              <Select
                className={ai.modelSelect}
                aria-label="ChatGPT 계정"
                value={status.activeAccountId ?? ""}
                disabled={busy}
                onChange={(event) =>
                  void run("select_chatgpt_account", { accountId: event.target.value })
                }
              >
                {!status.activeAccountId && <option value="">계정 선택</option>}
                {status.accounts.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.label}
                    {value.connected ? "" : " · 다시 연결 필요"}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <Checkbox
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
            label="대화와 고른 자료를 ChatGPT로 보내는 데 동의해요"
          />
          <p className={figma.caption}>
            내 플랜의 사용량을 써요. 기존 ChatGPT 대화나 기억은 가져오지 않아요.
          </p>
          <div className={figma.controls}>
            <Button
              variant="ghost"
              size="small"
              disabled={busy || !consent}
              onClick={() =>
                void run("login_chatgpt", {
                  ...(account ? { accountId: account.id } : {}),
                  consent: true,
                })
              }
            >
              {account || connectionFailure ? "다시 연결" : "ChatGPT로 연결"}
            </Button>
            {account && (
              <Button
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => void run("logout_chatgpt", { accountId: account.id })}
              >
                연결 끊기
              </Button>
            )}
            {!!status?.accounts.length && (
              <Button
                variant="link"
                size="small"
                disabled={busy || !consent}
                onClick={() => void run("login_chatgpt", { consent: true })}
              >
                계정 추가…
              </Button>
            )}
            {loginPending && (
              <Button
                variant="ghost"
                size="small"
                disabled={pending === "cancel_chatgpt_login"}
                onClick={() => void run("cancel_chatgpt_login")}
              >
                연결 취소
              </Button>
            )}
          </div>
          <p className={figma.caption}>
            연결 정보는 운영체제 보안 저장소에만 두고 화면이나 기억에 남기지 않아요.
          </p>
          <p className={figma.caption}>
            연결만으로 사용하는 AI가 바뀌지는 않아요. 모델을 선택하고 AI 연결을 저장해 주세요.
          </p>
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
                연결은 완료됐지만 Comet에서 ChatGPT 플랜을 사용할 권한이 없어요. 전송 안내에
                동의한 뒤 다시 연결하거나 다른 AI를 선택해 주세요.
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
        <div className={styles.heading}>
          <h2 className={styles.title}>ChatGPT로 대화하기</h2>
          <span className={styles.caption}>
            {loginPending ? "브라우저에서 연결 중" : requestState}
          </span>
        </div>
        <p className={styles.caption}>
          ChatGPT 플랜으로 캐릭터와 대화해요. 기존 ChatGPT 대화나 기억은 가져오지 않아요.
        </p>
        {account?.connected && !account.sharing && (
          <p role="alert" className={s.error}>
            연결은 완료됐지만 Comet에서 ChatGPT 플랜을 사용할 권한이 없어요. 전송 안내에 동의한 뒤
            다시 연결하거나 다른 AI를 선택해 주세요.
          </p>
        )}
        {status?.accounts.length ? (
          <FormField label="ChatGPT 계정" className={styles.field}>
            <Select
              fill
              value={status.activeAccountId ?? ""}
              disabled={busy}
              onChange={(event) =>
                void run("select_chatgpt_account", { accountId: event.target.value })
              }
            >
              {!status.activeAccountId && <option value="">계정 선택</option>}
              {status.accounts.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.label}
                  {value.connected ? "" : " · 다시 연결 필요"}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        <Checkbox
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
          label="대화와 선택한 자료를 ChatGPT로 보내고 내 플랜의 사용량을 쓰는 데 동의해요."
        />
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={busy || !consent}
            onClick={() => void run("login_chatgpt", { consent: true })}
          >
            {connectionFailure ? "다시 연결" : "ChatGPT로 연결"}
          </Button>
          {account && (!account.connected || !account.sharing) && (
            <Button
              variant="ghost"
              disabled={busy || !consent}
              onClick={() => void run("login_chatgpt", { accountId: account.id, consent: true })}
            >
              선택한 계정 다시 연결
            </Button>
          )}
          {loginPending && (
            <Button
              variant="ghost"
              disabled={pending === "cancel_chatgpt_login"}
              onClick={() => void run("cancel_chatgpt_login")}
            >
              연결 취소
            </Button>
          )}
          {account && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run("logout_chatgpt", { accountId: account.id })}
            >
              선택한 계정 연결 끊기
            </Button>
          )}
        </div>
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
        {status?.notice && status.notice !== error && pending !== "login_chatgpt" && (
          <p role="status" className={styles.caption}>
            {status.notice}
          </p>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {!status && !error && <p role="status">연결 상태를 확인하고 있어요.</p>}
      </div>
      {footer}
    </Surface>
  );
}
