import { useEffect, useRef, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Button,
  Checkbox,
  FormField,
  Rule,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
} from "@fleetia/lagrange";
import type { LocalModel, LocalModelTest, Memory, Settings, Snapshot } from "../types";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import { WordbookPanel } from "./WordbookPanel";
import { DesktopPreferences } from "./DesktopPreferences";
import { UpdatePanel } from "./UpdatePanel";
import { WindowHeader } from "./WindowHeader";
import * as s from "../lagrange.css";
import * as d from "../desktop.css";

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
      <TextArea
        aria-label="기억 내용"
        disabled={pending}
        value={value}
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className={s.row}>
        <Button
          variant="secondary"
          disabled={pending || !value.trim() || value === memory.content}
          onClick={() => void update(false)}
        >
          수정 저장
        </Button>
        <Button variant="quiet" disabled={pending} onClick={() => void update(true)}>
          이 기억 지우기
        </Button>
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
  const [section, setSection] = useState(
    new URLSearchParams(window.location.search).get("section") === "updates"
      ? "updates"
      : "general",
  );
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen("open-updates", () => setSection("updates"))
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanup = unlisten;
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(errorText(cause));
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
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
  async function run(name: string, commandArgs?: Record<string, unknown>): Promise<void> {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      let args = commandArgs;
      if (name === "save_settings" || name === "test_connection") {
        args = { settings, apiKey: apiKey.trim() || null };
      } else if (name === "download_model") {
        args = { model: settings.localModel };
      } else if (name === "test_local_model") {
        args = { settings };
      }
      if (name === "pick_model_file") {
        const picked = await command<string | null>(name);
        if (picked) {
          change("localModelPath", picked);
        }
        return;
      }
      if (name === "test_local_model") {
        const result = await command<LocalModelTest>(name, args);
        setNotice(`${(result.elapsedMs / 1000).toFixed(1)}초 · ${result.reply}`);
        return;
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
  const customModel = settings.localModel === "custom";
  const selectedModel = snapshot.localModels.find((model) => model.id === settings.localModel);
  const download = activeDownload?.model === settings.localModel ? activeDownload : null;
  const received = download?.received ?? selectedModel?.downloadedBytes ?? 0;
  const total = download?.total || selectedModel?.size || 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  const showProgress =
    !customModel && (download !== null || (!selectedModel?.ready && received > 0));
  const downloadingModel = snapshot.localModels.find((model) => model.id === activeDownload?.model);
  const canTestLocal = customModel
    ? settings.localModelPath.trim().length > 0
    : selectedModel?.ready === true;
  let downloadLabel = received > 0 ? "이어받기" : "모델 내려받기";
  if (selectedModel?.ready) {
    downloadLabel = "모델 준비 완료";
  } else if (download?.status === "verifying") {
    downloadLabel = "모델 파일 확인 중";
  } else if (download?.status === "downloading") {
    downloadLabel = "내려받는 중";
  }
  const hasChanges = dirty.current || apiKey.length > 0;
  const isSettingsSection = section === "general" || section === "model";
  const validInterval =
    Number.isInteger(settings.idleMinutes) &&
    settings.idleMinutes >= 1 &&
    settings.idleMinutes <= 60;
  const Container = preview ? "section" : "main";
  return (
    <Container className={`${s.settings} ${preview ? s.previewSettings : ""}`}>
      <WindowHeader className={d.pageHeader} label="설정 닫기" preview={preview}>
        <div>
          <p className={s.eyebrow}>COMET</p>
          <h1 className={s.settingsTitle}>설정</h1>
          <p className={s.quiet}>함께 지내는 방식과 나만의 대사를 정해요.</p>
        </div>
      </WindowHeader>
      <Tabs value={section} onValueChange={setSection} className={d.tabs}>
        <TabList aria-label="설정 항목" className={d.tabList}>
          <Tab value="general">기본 동작</Tab>
          <Tab value="model">대화 모델</Tab>
          <Tab value="wordbook">개인 단어장</Tab>
          <Tab value="memory">기억</Tab>
          <Tab value="updates">업데이트</Tab>
        </TabList>
        <TabPanel value="general" className={d.tabPanel}>
          <p className={d.info}>
            모델을 설치하지 않아도 인사와 자동 잡담, 등록한 대사를 사용할 수 있어요.
          </p>
          <fieldset className={d.fieldset} disabled={!!pending}>
            <legend className={s.sectionTitle}>먼저 이야기하기</legend>
            <Checkbox
              className={s.row}
              checked={settings.autonomousEnabled}
              onChange={(event) => change("autonomousEnabled", event.target.checked)}
            >
              바탕화면에서 먼저 이야기하기
            </Checkbox>
            <p className={s.quiet}>
              끄면 먼저 시작하는 대화를 멈춰요. 직접 말을 거는 것은 그대로 사용할 수 있어요.
            </p>
            <div className={d.subsettings}>
              <FormField
                className={s.field}
                label="이야기 간격"
                description="1~60분. 실제 간격은 조금씩 달라져요."
              >
                <TextField
                  className={d.shortInput}
                  type="number"
                  min={1}
                  max={60}
                  value={settings.idleMinutes}
                  onChange={(event) => change("idleMinutes", Number(event.target.value))}
                />
              </FormField>
              <Checkbox
                className={s.row}
                disabled={!settings.autonomousEnabled}
                checked={settings.localIdleEnabled}
                onChange={(event) => change("localIdleEnabled", event.target.checked)}
              >
                로컬 모델로 새 잡담 만들기
              </Checkbox>
              <Checkbox
                className={s.row}
                disabled={!settings.autonomousEnabled}
                checked={settings.apiIdleEnabled}
                onChange={(event) => change("apiIdleEnabled", event.target.checked)}
              >
                API로 새 잡담 만들기
              </Checkbox>
              <p className={s.quiet}>
                선택한 대화 방식이 준비되면 사용해요. API 잡담은 기본으로 꺼져 있으며, 켜면 자동
                요청과 비용이 발생할 수 있어요.
              </p>
            </div>
          </fieldset>
          {snapshot.runtime.paused && (
            <div className={s.section}>
              <p className={s.quiet}>
                지금은 자동 잡담을 잠시 쉬고 있어요. 저장한 설정과 별도로 일시정지된 상태예요.
              </p>
              <Button
                variant="secondary"
                disabled={!!pending}
                onClick={() => void run("set_paused", { paused: false })}
              >
                자동 잡담 다시 시작
              </Button>
            </div>
          )}
          <details className={d.disclosure}>
            <summary className={d.disclosureSummary}>표시와 종료</summary>
            <p className={s.quiet}>
              캐릭터를 숨겨도 위젯을 사용할 수 있어요. 메뉴 막대나 알림 영역에서 각각 다시 열 수
              있어요.
            </p>
            <div className={s.row}>
              <Button
                variant="secondary"
                disabled={!!pending}
                onClick={() => void run("hide_boxes")}
              >
                상자 숨기기
              </Button>
              <Button variant="quiet" disabled={!!pending} onClick={() => void run("quit_app")}>
                앱 종료
              </Button>
            </div>
          </details>
          <DesktopPreferences hidden={snapshot.runtime.hidden} />
        </TabPanel>
        <TabPanel value="updates" className={d.tabPanel}>
          <UpdatePanel />
        </TabPanel>
        <TabPanel value="model" className={d.tabPanel}>
          <p className={d.info}>
            자유로운 대화와 새로운 잡담을 위한 선택 설정이에요. 로컬 모델은 이 기기에서, 외부 API는
            선택한 제공자에게 내용을 보내 처리해요.
          </p>
          <fieldset className={d.fieldset} disabled={!!pending} aria-label="대화 모델 설정">
            <div className={d.modeChoices} role="group" aria-label="대화 방식">
              <Button
                variant="secondary"
                className={s.choice}
                aria-pressed={settings.mode === "local"}
                onClick={() => change("mode", "local")}
              >
                이 기기에서
              </Button>
              <Button
                variant="secondary"
                className={s.choice}
                aria-pressed={settings.mode === "api"}
                onClick={() => change("mode", "api")}
              >
                외부 API로
              </Button>
            </div>
            {settings.mode === "local" ? (
              <section>
                <h2 className={s.sectionTitle}>이 기기에서 대화하기</h2>
                <FormField className={s.field} label="로컬 모델">
                  <Select
                    value={settings.localModel}
                    disabled={!!pending || downloading}
                    onChange={(event) => change("localModel", event.target.value as LocalModel)}
                  >
                    {snapshot.localModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} · {model.description}
                      </option>
                    ))}
                    <option value="custom">직접 지정한 GGUF 파일</option>
                  </Select>
                </FormField>
                {customModel ? (
                  <FormField
                    className={s.field}
                    label="GGUF 파일 경로"
                    description="이 기기에 있는 GGUF 파일의 절대 경로예요. 앱이 관리하는 llama-server로 실행해요."
                  >
                    <div className={s.row}>
                      <TextField
                        spellCheck={false}
                        value={settings.localModelPath}
                        onChange={(event) => change("localModelPath", event.target.value)}
                        placeholder="/path/to/model.gguf"
                      />
                      <Button
                        variant="secondary"
                        disabled={!!pending}
                        onClick={() => void run("pick_model_file")}
                      >
                        파일 선택
                      </Button>
                    </div>
                  </FormField>
                ) : (
                  <p className={d.data}>
                    {selectedModel?.name} Q4_K_M · 다운로드{" "}
                    {((selectedModel?.size ?? 0) / 1_000_000_000).toFixed(2)} GB
                  </p>
                )}
                {(settings.localModel !== snapshot.settings.localModel ||
                  settings.localModelPath !== snapshot.settings.localModelPath) && (
                  <p className={s.quiet}>선택한 모델로 대화하려면 아래에서 설정을 저장해 주세요.</p>
                )}
                <p className={s.quiet}>
                  자유롭게 대화하고 싶을 때 모델을 내려받으세요. 기본 인사와 등록 대사는 설치 없이도
                  사용할 수 있어요. 모델을 불러올 때는 잠깐 기다릴 수 있어요.
                </p>
                <div className={s.row}>
                  {!customModel && (
                    <Button
                      variant="primary"
                      disabled={!!pending || downloading || !selectedModel || selectedModel.ready}
                      onClick={() => void run("download_model")}
                    >
                      {downloadLabel}
                    </Button>
                  )}
                  {downloading && (
                    <Button
                      variant="secondary"
                      disabled={!!pending}
                      onClick={() => void run("cancel_download")}
                    >
                      다운로드 중단
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={!!pending || downloading || !canTestLocal}
                    onClick={() => void run("test_local_model")}
                  >
                    {pending === "test_local_model" ? "테스트 중…" : "테스트하기"}
                  </Button>
                </div>
                <p className={s.quiet}>
                  테스트는 선택한 모델을 불러와 짧은 인사에 답하게 하고, 걸린 시간과 답을 아래에
                  보여 줘요. 저장하지 않은 선택도 테스트할 수 있어요.
                </p>
                {downloading && !download && (
                  <p className={s.quiet}>
                    {downloadingModel?.name} 파일을 준비하고 있어요. 완료하거나 중단한 뒤 다른
                    모델을 내려받을 수 있어요.
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
                <FormField className={s.field} label="API 주소">
                  <TextField
                    type="url"
                    spellCheck={false}
                    value={settings.baseUrl}
                    onChange={(event) => change("baseUrl", event.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </FormField>
                <FormField className={s.field} label="모델 이름">
                  <TextField
                    value={settings.apiModel}
                    spellCheck={false}
                    onChange={(event) => change("apiModel", event.target.value)}
                    placeholder="사용할 모델의 정확한 이름"
                  />
                </FormField>
                <FormField
                  className={s.field}
                  label="API 키"
                  description="키는 운영체제 보안 저장소에 보관해요. 저장하면 입력란을 비워요."
                >
                  <TextField
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      snapshot.hasApiKey
                        ? "저장된 키 사용 · 변경할 때만 입력"
                        : "API 키를 입력해 주세요"
                    }
                  />
                </FormField>
                {snapshot.hasApiKey && (
                  <div className={s.row}>
                    <Button
                      variant="secondary"
                      disabled={!!pending || settings.baseUrl !== snapshot.settings.baseUrl}
                      onClick={() => void run("clear_api_key")}
                    >
                      {pending === "clear_api_key" ? "키 삭제 중…" : "저장된 API 키 삭제"}
                    </Button>
                    {settings.baseUrl !== snapshot.settings.baseUrl && (
                      <span className={s.quiet}>
                        주소를 변경한 상태예요. 삭제하려면 저장된 주소로 되돌려 주세요.
                      </span>
                    )}
                  </div>
                )}
                <details className={s.quiet}>
                  <summary>API 호환성 설정</summary>
                  <FormField className={s.field} label="응답 길이 매개변수">
                    <Select
                      value={settings.apiTokenParameter}
                      onChange={(event) =>
                        change(
                          "apiTokenParameter",
                          event.target.value as Settings["apiTokenParameter"],
                        )
                      }
                    >
                      <option value="max_tokens">max_tokens</option>
                      <option value="max_completion_tokens">max_completion_tokens</option>
                    </Select>
                  </FormField>
                </details>
                <div className={s.row}>
                  <Button
                    variant="secondary"
                    disabled={
                      !!pending ||
                      !settings.baseUrl ||
                      !settings.apiModel ||
                      (!apiKey && !snapshot.hasApiKey)
                    }
                    onClick={() => void run("test_connection")}
                  >
                    {pending === "test_connection" ? "연결 확인 중…" : "연결 테스트"}
                  </Button>
                  <span className={s.quiet}>테스트 요청에도 제공자 요금이 발생할 수 있어요.</span>
                </div>
              </section>
            )}
          </fieldset>
          {snapshot.runtime.error && (
            <p className={s.error} role="alert">
              {snapshot.runtime.error}
            </p>
          )}
        </TabPanel>
        <TabPanel value="wordbook" className={d.tabPanel}>
          <WordbookPanel
            entries={snapshot.wordbook}
            title="개인 단어장"
            description="캐릭터를 바꿔도 A/B 자리에 적용되는 나만의 대사예요. 키워드가 포함되면 모델 없이 그대로 재생해요."
          />
        </TabPanel>
        <TabPanel value="memory" className={d.tabPanel}>
          <section>
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
        </TabPanel>
      </Tabs>
      {isSettingsSection ? (
        <footer className={d.saveBar}>
          <Rule variant="structural" />
          <div className={d.saveActions}>
            <Button
              variant="primary"
              disabled={!!pending || !hasChanges || !validInterval}
              onClick={() => void run("save_settings")}
            >
              {pending === "save_settings" ? "저장 중…" : "설정 저장"}
            </Button>
            {hasChanges && (
              <Button
                variant="quiet"
                disabled={!!pending}
                onClick={() => {
                  dirty.current = false;
                  setSettings(snapshot.settings);
                  setApiKey("");
                  setError(null);
                  setNotice(null);
                }}
              >
                변경 취소
              </Button>
            )}
            <span className={d.saveStatus} role="status">
              {hasChanges ? "기본 동작·대화 모델의 변경을 함께 저장해요." : "저장된 설정이에요."}
            </span>
          </div>
          {!validInterval && (
            <p className={s.error} role="alert">
              기본 동작에서 이야기 간격을 1~60분으로 입력해 주세요.
            </p>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className={s.success} role="status">
              {notice}
            </p>
          )}
        </footer>
      ) : hasChanges ? (
        <p className={s.quiet}>
          기본 동작·대화 모델에 저장하지 않은 변경이 있어요. 해당 탭에서 저장할 수 있어요.
        </p>
      ) : null}
    </Container>
  );
}
