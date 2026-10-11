import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { Button, Checkbox, FormField, Select, Surface } from "@fleetia/lagrange";
import type { SettingsDraft } from "../../hooks/useSettingsDraft";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as styles from "../ModelSettings/modelSettings.css";
import * as s from "../../lagrange.css";

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
}: {
  draft: SettingsDraft;
  footer?: ReactNode;
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
      if (!account?.connected) {
        modelAccount.current = null;
        setModels([]);
        setModelsLoaded(false);
      } else if (modelAccount.current !== account.id) {
        // A failed catalog request waits for explicit retry instead of every status poll.
        modelAccount.current = account.id;
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
  const loginPending = status?.loginPending || pending === "login_chatgpt";
  const busy = Boolean(pending || loginPending || !isDesktop());
  const missingModel =
    modelsLoaded &&
    Boolean(draft.settings.chatgptModel) &&
    !models.some((model) => model.slug === draft.settings.chatgptModel);
  return (
    <Surface className={styles.connectionPanel} aria-label="ChatGPT 연결">
      <div className={styles.body}>
        <div className={styles.heading}>
          <h2 className={styles.title}>ChatGPT로 대화하기</h2>
          <span className={styles.caption}>
            {loginPending ? "브라우저에서 로그인 중" : account?.connected ? "연결됨" : "연결 필요"}
          </span>
        </div>
        <p className={styles.caption}>
          ChatGPT 플랜으로 캐릭터와 대화해요. 기존 ChatGPT 대화나 기억은 가져오지 않아요.
        </p>
        {status?.accounts.length ? (
          <FormField label="ChatGPT 계정" className={styles.field}>
            <Select
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
        >
          대화와 선택한 자료를 ChatGPT로 보내고 내 플랜의 사용량을 쓰는 데 동의해요.
        </Checkbox>
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={busy || !consent}
            onClick={() => void run("login_chatgpt", { consent: true })}
          >
            ChatGPT로 로그인
          </Button>
          {account && !account.connected && (
            <Button
              variant="secondary"
              disabled={busy || !consent}
              onClick={() => void run("login_chatgpt", { accountId: account.id, consent: true })}
            >
              선택한 계정 다시 연결
            </Button>
          )}
          {loginPending && (
            <Button
              variant="secondary"
              disabled={pending === "cancel_chatgpt_login"}
              onClick={() => void run("cancel_chatgpt_login")}
            >
              로그인 취소
            </Button>
          )}
          {account && (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void run("logout_chatgpt", { accountId: account.id })}
            >
              선택한 계정 로그아웃
            </Button>
          )}
        </div>
        <FormField label="ChatGPT 모델" className={styles.field}>
          <Select
            value={draft.settings.chatgptModel}
            disabled={!account?.connected || busy || models.length === 0}
            onChange={(event) => draft.change("chatgptModel", event.target.value)}
          >
            {!draft.settings.chatgptModel && <option value="">연결 후 모델 선택</option>}
            {missingModel && (
              <option value={draft.settings.chatgptModel}>
                {draft.settings.chatgptModel} · 사용할 수 없음
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
        {account?.connected && (
          <Button
            variant="quiet"
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
          variant="quiet"
          disabled={!isDesktop()}
          onClick={() => void run("open_chatgpt_usage")}
        >
          ChatGPT 플랜·사용량 확인 ↗
        </Button>
        {status?.requestBlocked && account && (
          <Button
            variant="secondary"
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
        {status?.notice && (
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
