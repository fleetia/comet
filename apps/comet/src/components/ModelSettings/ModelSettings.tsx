import { useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { BoltIcon, ImportIcon, MemoryIcon, PauseIcon, ShieldIcon, SparkleIcon } from "@comet/icon";
import {
  Button,
  Select,
  SettingControlRow,
  SettingsSummary,
  Switch,
  TextInput,
  Dialog,
} from "@comet/ui";
import { MemorySearchSettings } from "../MemorySettings/MemorySearchSettings";
import { ChatGptSettings } from "../ChatGptSettings/ChatGptSettings";
import { AppleModelSettings } from "./AppleModelSettings";
import { OrganizerSettings } from "../OrganizerSettings/OrganizerSettings";
import type { AiProvider, LocalModel, LocalModelStatus, Settings, Snapshot } from "../../types";
import {
  API_MODEL_EXAMPLES,
  getAiProvider,
  getAiProviders,
  getAiProviderLabel,
  getApiProfile,
  getRecommendedAiProvider,
} from "../../aiProviders";
import type { SettingsDraft } from "../../hooks/useSettingsDraft";
import * as common from "../../common.css";
import * as figma from "../SettingsPanel/figmaSettings.css";
import * as styles from "./aiSettings.css";

type Props = {
  snapshot: Snapshot;
  draft: SettingsDraft;
  automaticDraft?: SettingsDraft;
  automaticFooter?: ReactNode;
  footer?: ReactNode;
  onOpenOrganizer?: () => void;
  onOrganizerDirtyChange?: (dirty: boolean) => void;
};
const FIT_LABELS: Record<LocalModelStatus["fit"], string> = {
  fits: "이 컴퓨터에 알맞아요",
  tight: "메모리를 많이 써서 느릴 수 있어요",
  insufficient: "이 컴퓨터의 메모리로는 실행이 어려울 수 있어요",
  unknown: "이 컴퓨터의 메모리를 확인하지 못했어요",
};
function isKeylessApiUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.href.includes("?") &&
      !url.href.includes("#")
    );
  } catch {
    return false;
  }
}
export function ModelSettings({
  snapshot,
  draft,
  automaticDraft,
  automaticFooter,
  footer,
  onOrganizerDirtyChange,
  onOpenOrganizer,
}: Props): JSX.Element {
  const { settings, apiKey, setApiKey, pending, change, selectProvider, run } = draft;
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [organizerVisited, setOrganizerVisited] = useState(false);
  const [editingKeyFor, setEditingKeyFor] = useState<string | null>(null);
  const selectedModel = snapshot.localModels.find((model) => model.id === settings.localModel);
  const customModel = settings.localModel === "custom";
  const activeDownload = snapshot.runtime.download;
  const downloading =
    activeDownload !== null && ["downloading", "verifying"].includes(activeDownload.status);
  const download =
    settings.mode === "local" && activeDownload?.model === settings.localModel
      ? activeDownload
      : null;
  const received = download?.received ?? selectedModel?.downloadedBytes ?? 0;
  const total = download?.total || selectedModel?.size || 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const ready = customModel ? !!settings.localModelPath.trim() : selectedModel?.ready === true;
  const keylessApi = isKeylessApiUrl(settings.baseUrl);
  const provider = getAiProvider(settings);
  const providerLabel = getAiProviderLabel(settings);
  const recommendedProvider = getRecommendedAiProvider(snapshot.device.platform);
  const customApi = settings.apiProvider === "custom";
  const savedProfile = getApiProfile(snapshot.settings, settings.apiProvider);
  const hasSavedApiKey =
    settings.baseUrl === savedProfile.baseUrl &&
    (snapshot.apiKeyProviders.includes(settings.apiProvider) ||
      (snapshot.hasApiKey && settings.apiProvider === snapshot.settings.apiProvider));
  const editingKey = editingKeyFor === settings.baseUrl || Boolean(apiKey);
  const tested = draft.notice === "연결을 확인했어요.";
  const providerHeader = (
    <>
      <h1 className={figma.inspectorTitle}>
        <span className={figma.icon}>
          <SparkleIcon size={18} />
        </span>
        대화에 쓸 AI
      </h1>
      <Select
        aria-label="대화에 쓸 AI"
        value={provider}
        onChange={(event) => selectProvider(event.target.value as AiProvider)}
        disabled={!!pending}
        className={styles.provider}
      >
        {getAiProviders(snapshot.device.platform, provider).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
            {item.value === recommendedProvider ? " · 추천" : ""}
          </option>
        ))}
      </Select>
      {recommendedProvider && (
        <p className={figma.caption}>
          {snapshot.device.platform === "macos"
            ? "macOS에서는 Apple 온디바이스 AI를"
            : "Windows에서는 ChatGPT를"}{" "}
          먼저 추천해요. 저장한 선택은 유지해요.
        </p>
      )}
      <div className={figma.note}>
        <SparkleIcon size={13} />
        <p className={figma.caption}>AI가 없어도 인사, 단어장, 대화팩 대사는 그대로 동작해요.</p>
      </div>
      {provider !== getAiProvider(snapshot.settings) && (
        <p className={figma.caption}>
          <span>현재 사용 · {getAiProviderLabel(snapshot.settings)}</span> ·{" "}
          <span>저장 후 전환</span>
        </p>
      )}
    </>
  );
  const extras = (
    <>
      <MemorySearchSettings compact />
      <section className={figma.section}>
        <h2 className={figma.sectionTitle}>기억과 업무 정리</h2>
        <SettingsSummary
          className={figma.summary}
          title="Ex-brain"
          description="기록과 검색을 부탁하고, 쉬는 동안 자료를 정리해요"
          leading={
            <span className={figma.icon}>
              <MemoryIcon size={20} />
            </span>
          }
          onClick={() => {
            if (onOpenOrganizer) {
              onOpenOrganizer();
              return;
            }
            setOrganizerVisited(true);
            setOrganizerOpen(true);
          }}
        />
      </section>
    </>
  );
  const save = (draft.hasChanges || pending || draft.error || draft.notice) && footer;
  return (
    <div className={styles.root}>
      <div className={styles.connection} hidden={organizerOpen}>
        {settings.mode === "chatgpt" ? (
          <ChatGptSettings
            draft={draft}
            automaticDraft={automaticDraft}
            automaticFooter={automaticFooter}
            footer={save}
            inspectorHeader={providerHeader}
            supportingContent={extras}
          />
        ) : settings.mode === "apple" ? (
          <AppleModelSettings
            initialStatus={snapshot.appleModel}
            draft={draft}
            automaticDraft={automaticDraft}
            automaticFooter={automaticFooter}
            footer={save}
            inspectorHeader={providerHeader}
            supportingContent={extras}
          />
        ) : (
          <div className={figma.split}>
            <aside className={figma.inspector}>
              {providerHeader}
              {settings.mode === "local" ? (
                <>
                  <div className={styles.downloadPresentation}>
                    <div
                      className={styles.ring}
                      role="progressbar"
                      aria-label="모델 내려받기 진행률"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={ready ? 100 : percent}
                    >
                      <span
                        className={styles.ringFill}
                        style={{ "--model-progress": `${ready ? 100 : percent}%` } as CSSProperties}
                      />
                      <div className={styles.ringValue}>
                        <strong>{ready ? "준비됨" : `${percent}%`}</strong>
                        <span>
                          {download?.status === "verifying"
                            ? "파일 확인 중"
                            : downloading && download
                              ? "내려받는 중"
                              : ready
                                ? "대화할 수 있어요"
                                : "모델 준비 필요"}
                        </span>
                      </div>
                    </div>
                    <strong>
                      {customModel
                        ? "직접 지정한 GGUF"
                        : selectedModel
                          ? `${selectedModel.name} · ${selectedModel.quantization}`
                          : "모델 선택"}
                    </strong>
                    <p className={figma.caption}>
                      {customModel
                        ? settings.localModelPath || "선택한 파일 없음"
                        : `${(received / 1_000_000_000).toFixed(2)}GB / ${(total / 1_000_000_000).toFixed(2)}GB`}
                    </p>
                  </div>
                  <div className={styles.centerActions}>
                    {downloading ? (
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={!!pending}
                        onClick={() => void run("cancel_download")}
                      >
                        <PauseIcon size={15} />
                        멈추기
                      </Button>
                    ) : !customModel && !ready ? (
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={!!pending || !selectedModel}
                        onClick={() =>
                          selectedModel?.fit === "insufficient"
                            ? setConfirmDownload(true)
                            : void run("download_model")
                        }
                      >
                        <ImportIcon size={15} />
                        {download?.error && download.error !== "모델 내려받기가 중단됐어요."
                          ? "다시 시도"
                          : received ? "이어 받기" : "내려받기"}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.connectionStatus}>
                    <div className={figma.controls}>
                      <span className={figma.icon}>
                        <BoltIcon size={26} />
                      </span>
                      <div className={figma.noteCopy}>
                        <strong>{tested ? "연결됨" : "연결 확인 전"}</strong>
                        <span className={figma.caption}>
                          {draft.notice || "응답은 직접 확인한 뒤 표시해요"}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={
                        !!pending ||
                        !settings.baseUrl ||
                        !settings.apiModel ||
                        (!apiKey.trim() && !hasSavedApiKey && !keylessApi)
                      }
                      onClick={() => void run("test_connection")}
                    >
                      다시 확인
                    </Button>
                  </div>
                  <div className={styles.sharingNote}>
                    <ShieldIcon size={16} />
                    <p className={figma.caption}>
                      외부 API를 쓰면 대화 내용과 관련 기억 일부가 그 서비스로 보내져요.
                    </p>
                  </div>
                  <p className={figma.caption}>확인만으로 쓰는 방식이 바뀌지는 않아요.</p>
                </>
              )}
              {download?.error && (
                <>
                  <p className={common.error} role="alert">
                    {download.error}
                  </p>
                  {download.error === "모델 내려받기 서버(Hugging Face)에 연결할 수 없어요." && (
                    <p className={figma.caption}>
                      네트워크나 회사 방화벽이 huggingface.co를 막고 있을 수 있어요.
                    </p>
                  )}
                  <p className={figma.caption}>
                    AI 없이도 인사·단어장·대화팩은 계속 쓸 수 있어요.
                  </p>
                </>
              )}
              {snapshot.runtime.error &&
                !(download?.error &&
                  snapshot.runtime.error === "이 기기의 모델을 아직 내려받지 않았어요.") && (
                  <p className={common.error} role="alert">
                    {snapshot.runtime.error}
                  </p>
                )}
            </aside>
            <div className={figma.right}>
              <fieldset className={figma.form} disabled={!!pending} aria-label="대화 모델 설정">
                {settings.mode === "local" ? (
                  <section className={figma.section}>
                    <h2 className={figma.sectionTitle}>이 기기의 모델</h2>
                    <div className={figma.group}>
                      <SettingControlRow
                        className={`${figma.row} ${styles.modelRow}`}
                        title="모델"
                        description={
                          selectedModel
                            ? `${(selectedModel.size / 1_000_000_000).toFixed(2)}GB · ${FIT_LABELS[selectedModel.fit]}${selectedModel.widgetCreation ? " · 위젯 제작 가능" : ""}`
                            : "직접 고른 GGUF 파일"
                        }
                        control={
                          <Select
                            className={styles.modelSelect}
                            aria-label="이 기기의 모델"
                            value={settings.localModel}
                            disabled={downloading}
                            onChange={(event) =>
                              change("localModel", event.target.value as LocalModel)
                            }
                          >
                            {snapshot.localModels.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name} · {model.quantization} · {model.description}
                                {model.recommended ? " · 이 컴퓨터 추천" : ""}
                              </option>
                            ))}
                            <option value="custom">직접 지정한 GGUF 파일</option>
                          </Select>
                        }
                      />
                      <SettingControlRow
                        className={figma.row}
                        title="생각하고 답하기"
                        description="답하기 전에 더 생각해요. 느려질 수 있어요"
                        control={
                          <Switch
                            aria-label="로컬 추론 모드"
                            checked={settings.localReasoningEnabled}
                            onChange={(event) =>
                              change("localReasoningEnabled", event.target.checked)
                            }
                          />
                        }
                      />
                      <SettingControlRow
                        className={figma.row}
                        title="직접 고른 모델 파일 (GGUF)"
                        description={settings.localModelPath || "없음"}
                        control={
                          <Button
                            variant="ghost"
                            size="small"
                            onClick={() => {
                              change("localModel", "custom");
                              void run("pick_model_file");
                            }}
                          >
                            파일 고르기…
                          </Button>
                        }
                      />
                      {customModel && (
                        <SettingControlRow
                          className={figma.row}
                          title="GGUF 파일 경로"
                          control={
                            <TextInput
                              aria-label="GGUF 파일 경로"
                              className={styles.textField}
                              value={settings.localModelPath}
                              onChange={(event) => change("localModelPath", event.target.value)}
                            />
                          }
                        />
                      )}
                      <SettingControlRow
                        className={figma.row}
                        title="연결 확인"
                        description={draft.notice || "모델 준비가 끝나면 짧은 응답으로 확인해요"}
                        control={
                          <Button
                            variant="ghost"
                            size="small"
                            disabled={downloading || !ready}
                            onClick={() => void run("test_local_model")}
                          >
                            {pending === "test_local_model" ? "확인 중…" : "확인하기"}
                          </Button>
                        }
                      />
                    </div>
                  </section>
                ) : (
                  <>
                    <section className={figma.section}>
                      <h2 className={figma.sectionTitle}>{providerLabel}</h2>
                      <div className={figma.group}>
                        {customApi && (
                          <SettingControlRow
                            className={figma.row}
                            title="API 주소"
                            control={
                              <TextInput
                                type="url"
                                aria-label="API 주소"
                                className={styles.textField}
                                value={settings.baseUrl}
                                spellCheck={false}
                                onChange={(event) => change("baseUrl", event.target.value)}
                              />
                            }
                          />
                        )}
                        <SettingControlRow
                          className={figma.row}
                          title="모델 이름"
                          description="이 계정에서 사용할 모델 이름을 고르거나 직접 적어요"
                          control={
                            <>
                              <TextInput
                                aria-label="모델 이름"
                                className={styles.textField}
                                value={settings.apiModel}
                                spellCheck={false}
                                list={customApi ? undefined : `api-models-${settings.apiProvider}`}
                                placeholder={
                                  customApi
                                    ? "모델 이름"
                                    : `예: ${API_MODEL_EXAMPLES[settings.apiProvider][0]}`
                                }
                                onChange={(event) => change("apiModel", event.target.value)}
                              />
                              {!customApi && (
                                <datalist id={`api-models-${settings.apiProvider}`}>
                                  {API_MODEL_EXAMPLES[settings.apiProvider].map((model) => (
                                    <option key={model} value={model} />
                                  ))}
                                </datalist>
                              )}
                            </>
                          }
                        />
                        <SettingControlRow
                          className={figma.row}
                          title="API 키"
                          description="운영체제 보안 저장소에 보관해요"
                          control={
                            hasSavedApiKey && !editingKey ? (
                              <div className={styles.keyActions}>
                                <span className={figma.caption}>저장됨</span>
                                <Button
                                  variant="ghost"
                                  size="small"
                                  onClick={() => setEditingKeyFor(settings.baseUrl)}
                                >
                                  바꾸기…
                                </Button>
                                <Button
                                  variant="link"
                                  size="small"
                                  disabled={settings.baseUrl !== savedProfile.baseUrl}
                                  onClick={() => void run("clear_api_key")}
                                >
                                  지우기
                                </Button>
                              </div>
                            ) : (
                              <TextInput
                                type="password"
                                aria-label="API 키"
                                className={styles.textField}
                                value={apiKey}
                                autoComplete="off"
                                placeholder={
                                  keylessApi ? "키 없이 연결 가능" : "API 키를 입력해 주세요"
                                }
                                onChange={(event) => setApiKey(event.target.value)}
                              />
                            )
                          }
                        />
                        {customApi && (
                          <SettingControlRow
                            className={figma.row}
                            title="응답 길이를 정하는 이름"
                            description="API마다 이름이 달라요"
                            control={
                              <Select
                                aria-label="응답 길이 매개변수"
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
                            }
                          />
                        )}
                      </div>
                    </section>
                    {automaticDraft && (
                      <section className={figma.section}>
                        <h2 className={figma.sectionTitle}>자동 잡담</h2>
                        <div className={figma.group}>
                          <SettingControlRow
                            className={figma.row}
                            title="API로 새 잡담 만들기"
                            description="자동 요청에 제공자 요금이 붙을 수 있어요 · 설정 → 대화에서도 바꿀 수 있어요"
                            control={
                              <Switch
                                aria-label="API로 새 잡담 만들기"
                                checked={automaticDraft.settings.apiIdleEnabled}
                                disabled={Boolean(automaticDraft.pending)}
                                onChange={(event) =>
                                  automaticDraft.change("apiIdleEnabled", event.target.checked)
                                }
                              />
                            }
                          />
                        </div>
                        {automaticDraft.hasChanges && automaticFooter}
                      </section>
                    )}
                  </>
                )}
              </fieldset>
              {extras}
              {save}
            </div>
          </div>
        )}
      </div>
      {organizerVisited && (
        <div hidden={!organizerOpen} className={styles.organizer}>
          <Button variant="ghost" size="small" onClick={() => setOrganizerOpen(false)}>
            ‹ AI 연결
          </Button>
          <OrganizerSettings onDirtyChange={onOrganizerDirtyChange} />
        </div>
      )}
      <Dialog
        isOpen={confirmDownload}
        onOpenChange={setConfirmDownload}
        title="그래도 내려받을까요?"
        closeLabel="모델 내려받기 확인 닫기"
        variant="confirm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDownload(false)}>
              취소
            </Button>
            <Button
              disabled={!!pending || downloading}
              onClick={() => {
                setConfirmDownload(false);
                void run("download_model");
              }}
            >
              내려받기
            </Button>
          </>
        }
      >
        <p>{selectedModel?.name}: 이 컴퓨터의 메모리로는 실행되지 않거나 매우 느릴 수 있어요.</p>
        {snapshot.device.totalMemory && (
          <p>메모리 {Math.round(snapshot.device.totalMemory / 2 ** 30)}GB 기준 추정</p>
        )}
      </Dialog>
    </div>
  );
}
