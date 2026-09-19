import type { JSX } from "react";
import { Button, FormField, Select, TextField } from "@fleetia/lagrange";
import type { LocalModel, Settings, Snapshot } from "../types";
import type { SettingsDraft } from "../hooks/useSettingsDraft";
import * as s from "../lagrange.css";
import * as d from "../desktop.css";

type Props = { snapshot: Snapshot; draft: SettingsDraft };

export function ModelSettings({ snapshot, draft }: Props): JSX.Element {
  const { settings, apiKey, setApiKey, pending, change, run } = draft;
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
    <>
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
                    {model.name} ·{" "}
                    {model.id === "qwen3.5-4b" ? "기본 · 가벼운 모델" : "메모리를 더 사용하는 모델"}
                  </option>
                ))}
              </Select>
            </FormField>
            <p className={d.data}>
              {selectedModel?.name} Q4_K_M · 다운로드{" "}
              {((selectedModel?.size ?? 0) / 1_000_000_000).toFixed(2)} GB
            </p>
            {settings.localModel !== snapshot.settings.localModel && (
              <p className={s.quiet}>선택한 모델로 대화하려면 아래에서 설정을 저장해 주세요.</p>
            )}
            <p className={s.quiet}>
              자유롭게 대화하고 싶을 때 모델을 내려받으세요. 기본 인사와 등록 대사는 설치 없이도
              사용할 수 있어요. 모델을 불러올 때는 잠깐 기다릴 수 있어요.
            </p>
            <div className={s.row}>
              <Button
                variant="primary"
                disabled={!!pending || downloading || !selectedModel || selectedModel.ready}
                onClick={() => void run("download_model")}
              >
                {downloadLabel}
              </Button>
              {downloading && (
                <Button
                  variant="secondary"
                  disabled={!!pending}
                  onClick={() => void run("cancel_download")}
                >
                  다운로드 중단
                </Button>
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
                    change("apiTokenParameter", event.target.value as Settings["apiTokenParameter"])
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
    </>
  );
}
