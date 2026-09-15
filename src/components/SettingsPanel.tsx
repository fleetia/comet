import { useEffect, useRef, useState, type JSX } from "react";
import type { LocalModel, Memory, Settings, Snapshot } from "../types";
import { command, errorText } from "../hooks/useSnapshot";
import { WordbookPanel } from "./WordbookPanel";
import * as s from "../styles.css";

type Props = { snapshot: Snapshot; preview?: boolean };
function MemoryRow({ memory }: { memory: Memory }): JSX.Element {
  const [value, setValue] = useState(memory.content);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(memory.content), [memory.content]);
  async function update(remove: boolean): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await command(
        remove ? "delete_memory" : "edit_memory",
        remove ? { id: memory.id } : { id: memory.id, content: value.trim() },
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={s.memory}>
      <textarea
        className={s.textarea}
        aria-label="기억 내용"
        value={value}
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className={s.row}>
        <button
          className={s.button}
          disabled={pending || !value.trim() || value === memory.content}
          onClick={() => void update(false)}
        >
          수정 저장
        </button>
        <button className={s.select} disabled={pending} onClick={() => void update(true)}>
          이 기억 지우기
        </button>
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function SettingsPanel({ snapshot, preview = false }: Props): JSX.Element {
  const [settings, setSettings] = useState<Settings>(snapshot.settings);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!dirty.current) {
      setSettings(snapshot.settings);
    }
  }, [snapshot.settings]);
  function change<K extends keyof Settings>(key: K, value: Settings[K]): void {
    dirty.current = true;
    setSettings((previous) => ({ ...previous, [key]: value }));
  }
  async function run(name: string): Promise<void> {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      let args: Record<string, unknown> | undefined;
      if (name === "save_settings" || name === "test_connection") {
        args = { settings, apiKey: apiKey.trim() || null };
      } else if (name === "download_model") {
        args = { model: settings.localModel };
      }
      await command(name, args);
      if (name === "save_settings") {
        setApiKey("");
        dirty.current = false;
        setNotice("설정을 저장했어요.");
      }
      if (name === "clear_api_key") {
        setApiKey("");
        setNotice("저장된 API 키를 지웠어요.");
      }
      if (name === "test_connection") {
        setNotice("연결을 확인했어요.");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  const activeDownload = snapshot.runtime.download;
  const downloading =
    activeDownload !== null && ["downloading", "verifying"].includes(activeDownload.status);
  const selectedModel = snapshot.localModels.find((model) => model.id === settings.localModel);
  const download = activeDownload?.model === settings.localModel ? activeDownload : null;
  const received = download?.received ?? selectedModel?.downloadedBytes ?? 0;
  const total = download?.total || selectedModel?.size || 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  const showProgress = download !== null || (!selectedModel?.ready && received > 0);
  const downloadingModel = snapshot.localModels.find((model) => model.id === activeDownload?.model);
  let downloadLabel = received > 0 ? "이어받기" : "모델 내려받기";
  if (selectedModel?.ready) {
    downloadLabel = "모델 준비 완료";
  } else if (download?.status === "verifying") {
    downloadLabel = "모델 파일 확인 중";
  } else if (download?.status === "downloading") {
    downloadLabel = "내려받는 중";
  }
  return (
    <main className={`${s.settings} ${preview ? s.previewSettings : ""}`}>
      <p className={s.eyebrow}>NANIKA BOX / SETTINGS</p>
      <h1 className={s.settingsTitle}>함께 지내는 방법</h1>
      <p className={s.quiet}>대화 방식과 혼잣말, 기억을 여기서 관리해요.</p>
      <div className={s.tabs}>
        <button
          className={s.choice}
          aria-pressed={settings.mode === "local"}
          onClick={() => change("mode", "local")}
        >
          이 기기에서
          <br />
          <span className={s.quiet}>로컬 모델 · API 비용 없음</span>
        </button>
        <button
          className={s.choice}
          aria-pressed={settings.mode === "api"}
          onClick={() => change("mode", "api")}
        >
          외부 API로
          <br />
          <span className={s.quiet}>내 API 키로 연결</span>
        </button>
      </div>
      {settings.mode === "local" ? (
        <section>
          <h2 className={s.sectionTitle}>작은 모델 하나면 준비 끝</h2>
          <label className={s.field}>
            로컬 모델
            <select
              className={s.input}
              value={settings.localModel}
              disabled={!!pending || downloading}
              onChange={(event) => change("localModel", event.target.value as LocalModel)}
            >
              {snapshot.localModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ·{" "}
                  {model.id === "qwen3.5-4b" ? "기본 · 가벼운 모델" : "메모리를 더 사용하는 모델"}
                </option>
              ))}
            </select>
          </label>
          <p className={s.field}>
            {selectedModel?.name} Q4_K_M · 다운로드{" "}
            {((selectedModel?.size ?? 0) / 1_000_000_000).toFixed(2)} GB
          </p>
          {settings.localModel !== snapshot.settings.localModel && (
            <p className={s.quiet}>선택한 모델로 대화하려면 아래에서 설정을 저장해 주세요.</p>
          )}
          <p className={s.quiet}>
            첫 실행에 대화 모델을 내려받아요. 이후 대화는 이 기기에서 처리해요. 모델을 불러올 때
            잠깐 기다릴 수 있어요.
          </p>
          <div className={s.row}>
            <button
              className={s.primary}
              disabled={!!pending || downloading || !selectedModel || selectedModel.ready}
              onClick={() => void run("download_model")}
            >
              {downloadLabel}
            </button>
            {downloading && (
              <button
                className={s.button}
                disabled={!!pending}
                onClick={() => void run("cancel_download")}
              >
                다운로드 중단
              </button>
            )}
          </div>
          {downloading && !download && (
            <p className={s.quiet}>
              {downloadingModel?.name} 파일을 준비하고 있어요. 완료하거나 중단한 뒤 다른 모델을
              내려받을 수 있어요.
            </p>
          )}
          {download?.error && (
            <p className={s.error} role="alert">
              {download.error}
            </p>
          )}
          {showProgress && (
            <>
              <progress
                className={s.progress}
                max={100}
                value={percent ?? undefined}
                aria-label="모델 다운로드 진행률"
              />
              <p className={s.quiet}>
                {percent === null ? "용량 확인 중" : `${percent}%`} ·{" "}
                {(received / 1_000_000).toFixed(0)} MB
                {total > 0 ? ` / ${(total / 1_000_000).toFixed(0)} MB` : ""}
                {download?.status === "cancelled" ? " · 중단됨" : ""}
                {download?.status === "verifying" ? " · 파일 검증 중" : ""}
                {download?.status === "error" ? " · 다운로드 실패" : ""}
              </p>
            </>
          )}
        </section>
      ) : (
        <section>
          <label className={s.field}>
            API 주소
            <input
              className={s.input}
              type="url"
              spellCheck={false}
              value={settings.baseUrl}
              onChange={(event) => change("baseUrl", event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <label className={s.field}>
            모델 이름
            <input
              className={s.input}
              value={settings.apiModel}
              spellCheck={false}
              onChange={(event) => change("apiModel", event.target.value)}
              placeholder="사용할 모델의 정확한 이름"
            />
          </label>
          <label className={s.field}>
            API 키
            <input
              className={s.input}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                snapshot.hasApiKey ? "저장된 키 사용 · 변경할 때만 입력" : "API 키를 입력해 주세요"
              }
            />
            <span className={s.quiet}>
              키는 운영체제 보안 저장소에 보관해요. 저장하면 입력란을 비워요.
            </span>
          </label>
          {snapshot.hasApiKey && (
            <div className={s.row}>
              <button
                className={s.button}
                disabled={!!pending || settings.baseUrl !== snapshot.settings.baseUrl}
                onClick={() => void run("clear_api_key")}
              >
                {pending === "clear_api_key" ? "키 삭제 중…" : "저장된 API 키 삭제"}
              </button>
              {settings.baseUrl !== snapshot.settings.baseUrl && (
                <span className={s.quiet}>
                  주소를 변경한 상태예요. 삭제하려면 저장된 주소로 되돌려 주세요.
                </span>
              )}
            </div>
          )}
          <details className={s.quiet}>
            <summary>API 호환성 설정</summary>
            <label className={s.field}>
              응답 길이 매개변수
              <select
                className={s.input}
                value={settings.apiTokenParameter}
                onChange={(event) =>
                  change("apiTokenParameter", event.target.value as Settings["apiTokenParameter"])
                }
              >
                <option value="max_tokens">max_tokens</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
              </select>
            </label>
          </details>
          <div className={s.row}>
            <button
              className={s.button}
              disabled={
                !!pending ||
                !settings.baseUrl ||
                !settings.apiModel ||
                (!apiKey && !snapshot.hasApiKey)
              }
              onClick={() => void run("test_connection")}
            >
              {pending === "test_connection" ? "연결 확인 중…" : "연결 테스트"}
            </button>
            <span className={s.quiet}>테스트 요청에도 제공자 요금이 발생할 수 있어요.</span>
          </div>
        </section>
      )}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>조용할 때도, 가끔 한마디</h2>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={settings.autonomousEnabled}
            onChange={(event) => change("autonomousEnabled", event.target.checked)}
          />
          바탕화면에서 먼저 이야기하기
        </label>
        <p className={s.quiet}>모델이 없어도 준비된 이야기와 단어장으로 둘이 가끔 대화해요.</p>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={settings.localIdleEnabled}
            onChange={(event) => change("localIdleEnabled", event.target.checked)}
          />
          로컬 모델로 새 잡담 만들기
        </label>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={settings.apiIdleEnabled}
            onChange={(event) => change("apiIdleEnabled", event.target.checked)}
          />
          API로 새 잡담 만들기
        </label>
        <p className={s.quiet}>
          API로 새 잡담 만들기는 기본으로 꺼져 있어요. 켜면 입력하지 않아도 요청이 발생하며 비용이
          들 수 있어요.
        </p>
        <label className={s.row}>
          이야기 간격
          <input
            className={s.input}
            style={{ width: 72 }}
            type="number"
            min={1}
            max={60}
            value={settings.idleMinutes}
            onChange={(event) => change("idleMinutes", Number(event.target.value))}
          />
          분
        </label>
      </section>
      <div className={s.row}>
        <button
          className={s.primary}
          disabled={
            !!pending ||
            !Number.isInteger(settings.idleMinutes) ||
            settings.idleMinutes < 1 ||
            settings.idleMinutes > 60
          }
          onClick={() => void run("save_settings")}
        >
          {pending === "save_settings" ? "저장 중…" : "설정 저장"}
        </button>
      </div>
      {(error || snapshot.runtime.error) && (
        <p className={s.error} role="alert">
          {error || snapshot.runtime.error}
        </p>
      )}
      {notice && (
        <p className={s.success} role="status">
          {notice}
        </p>
      )}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>
          함께 기억하는 것 <span className={s.quiet}>{snapshot.memories.length}개</span>
        </h2>
        <p className={s.quiet}>
          대화에서 남긴 짧은 기억이에요. 잘못 기억한 내용은 고치거나 지울 수 있어요.
        </p>
        {snapshot.memories.length === 0 ? (
          <p className={s.emptyHint}>아직 기억이 없어요. 이야기를 나누며 하나씩 쌓아 갈게요.</p>
        ) : (
          snapshot.memories.map((memory) => <MemoryRow key={memory.id} memory={memory} />)
        )}
      </section>
      <section className={s.section}>
        <WordbookPanel entries={snapshot.wordbook} />
      </section>
      <section className={s.section}>
        <p className={s.quiet}>상자를 숨겨도 메뉴 막대에서 다시 열 수 있어요.</p>
        <div className={s.row}>
          <button className={s.button} disabled={!!pending} onClick={() => void run("hide_boxes")}>
            상자 숨기기
          </button>
          <button className={s.select} disabled={!!pending} onClick={() => void run("quit_app")}>
            앱 종료
          </button>
        </div>
      </section>
    </main>
  );
}
