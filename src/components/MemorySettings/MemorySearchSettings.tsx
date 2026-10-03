import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, Surface } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { MemorySearchStatus, NlpModel } from "../../types";
import * as s from "../../lagrange.css";
import * as styles from "./memorySearchSettings.css";

const LABELS: Record<NlpModel, string> = { kiwi: "한국어 분석", semantic: "의미 검색" };
const PREVIEW: MemorySearchStatus = {
  nlp: {
    settings: { kiwiEnabled: false, semanticEnabled: false },
    kiwi: {
      installed: false,
      enabled: false,
      state: "missing",
      downloadedBytes: 0,
      totalBytes: 87967233,
      error: null,
      profile: null,
    },
    semantic: {
      installed: false,
      enabled: false,
      state: "unavailable",
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
      profile: null,
    },
    running: false,
    busy: false,
    activeMethods: ["fts"],
  },
  analysis: { pending: 0, deferred: 0, legacyUnverified: 0 },
  index: { kiwiPending: 0, semanticPending: 0 },
};
const STATES: Record<string, string> = {
  idle: "필요할 때 불러옴",
  not_installed: "미설치",
  initializing: "불러오는 중",
  missing: "미설치",
  unavailable: "배포 파일 준비 중",
  installed: "설치됨",
  ready: "준비됨",
  loading: "불러오는 중",
  downloading: "내려받는 중",
  verifying: "파일 확인 중",
  disabled: "사용 안 함",
  error: "일시적으로 기본 검색 사용",
  cancelled: "다운로드 중단됨",
  uncalibrated: "검색 품질 검증 대기",
};

export function MemorySearchSettings({ className }: { className?: string }): JSX.Element {
  const [status, setStatus] = useState<MemorySearchStatus | null>(isDesktop() ? null : PREVIEW);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<NlpModel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const busy = useRef(false);
  async function refresh(): Promise<void> {
    const id = ++request.current;
    try {
      const value = await command<MemorySearchStatus>("get_nlp_status");
      if (mounted.current && id === request.current) {
        setStatus(value);
        setFetchError(null);
      }
    } catch (cause) {
      if (mounted.current && id === request.current) setFetchError(errorText(cause));
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
      request.current += 1;
      clearInterval(timer);
    };
  }, []);
  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      await command(name, args);
      if (mounted.current) {
        setConfirmRemove(null);
        if (name === "retry_memory_analysis")
          setNotice("보류된 대화를 유휴 시간에 다시 분석할게요.");
        await refresh();
      }
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }
  async function cancel(model: NlpModel): Promise<void> {
    try {
      await command("cancel_nlp_download", { model });
      if (mounted.current) await refresh();
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    }
  }
  return (
    <Surface className={`${styles.panel} ${className ?? ""}`} aria-label="기억 검색 설정">
      <div className={styles.body}>
        <div className={styles.heading}>
          <h2 className={styles.title}>기억 검색</h2>
          <p className={styles.caption}>
            현재 · 기본 검색{status?.nlp.activeMethods.includes("kiwi") ? " · 한국어 분석" : ""}
            {status?.nlp.activeMethods.includes("semantic") ? " · 의미 검색" : ""}
          </p>
        </div>
        {status ? (
          <>
            {(["kiwi", "semantic"] as const).map((model) => {
              const info = status.nlp[model];
              const downloading = ["downloading", "verifying"].includes(info.state);
              const queued =
                model === "kiwi" ? status.index.kiwiPending : status.index.semanticPending;
              return (
                <div key={model} className={styles.item}>
                  <div className={styles.controls}>
                    <div className={styles.copy}>
                      <h3 className={styles.itemTitle}>
                        {LABELS[model]}
                        {model === "kiwi" ? " · Kiwi" : ""}
                      </h3>
                      <p className={styles.caption}>
                        {model === "kiwi"
                          ? "조사·활용이 달라도 기억을 찾아요."
                          : "표현이 달라도 뜻이 비슷한 기억을 찾아요."}
                        {info.totalBytes > 0
                          ? ` · ${(info.totalBytes / 1_000_000).toFixed(1)} MB`
                          : ""}
                      </p>
                    </div>
                    <p className={styles.status}>
                      {STATES[info.state] ?? "상태 확인 중"}
                      {info.installed
                        ? ` · 검색 준비 ${queued > 0 ? `${queued}개 남음` : "완료"}`
                        : ""}
                    </p>
                    <Checkbox
                      className={styles.checkbox}
                      aria-label={`${LABELS[model]} 사용`}
                      checked={info.enabled}
                      disabled={!!pending || !info.installed || !isDesktop()}
                      onChange={(event) =>
                        void run("set_memory_search_settings", {
                          settings: {
                            ...status.nlp.settings,
                            [model === "kiwi" ? "kiwiEnabled" : "semanticEnabled"]:
                              event.target.checked,
                          },
                        })
                      }
                    >
                      사용
                    </Checkbox>
                    <div className={styles.actions}>
                      {!info.installed && !downloading && (
                        <Button
                          className={styles.action}
                          aria-label={`${LABELS[model]} 내려받기`}
                          variant="secondary"
                          disabled={!!pending || info.state === "unavailable" || !isDesktop()}
                          onClick={() => void run("download_nlp_model", { model })}
                        >
                          내려받기
                        </Button>
                      )}
                      {downloading && (
                        <Button
                          className={styles.action}
                          aria-label={`${LABELS[model]} 다운로드 중단`}
                          variant="quiet"
                          onClick={() => void cancel(model)}
                        >
                          다운로드 중단
                        </Button>
                      )}
                      {info.installed && (
                        <Button
                          className={styles.action}
                          aria-label={`${LABELS[model]} 제거`}
                          variant="quiet"
                          disabled={!!pending}
                          onClick={() => setConfirmRemove(model)}
                        >
                          제거
                        </Button>
                      )}
                    </div>
                  </div>
                  {downloading && (
                    <progress
                      className={s.progress}
                      aria-label={`${LABELS[model]} 다운로드 진행`}
                      max={info.totalBytes || 1}
                      value={info.downloadedBytes}
                    />
                  )}
                  {confirmRemove === model && (
                    <div className={styles.confirmation}>
                      <p className={styles.caption}>
                        검색 모델과 다시 만들 수 있는 색인을 제거해요. 원문과 기억은 그대로 남아요.
                      </p>
                      <div className={styles.confirmationActions}>
                        <Button
                          variant="secondary"
                          disabled={!!pending}
                          onClick={() => void run("remove_nlp_model", { model })}
                        >
                          {LABELS[model]} 제거 확인
                        </Button>
                        <Button
                          variant="quiet"
                          disabled={!!pending}
                          onClick={() => setConfirmRemove(null)}
                        >
                          제거 취소
                        </Button>
                      </div>
                    </div>
                  )}
                  {info.error && <p className={styles.caption}>{info.error}</p>}
                  <div className={styles.boundary} />
                </div>
              );
            })}
            <div className={styles.queue}>
              <p className={styles.caption}>
                기억 분석 대기 {status.analysis.pending}개 · 보류 {status.analysis.deferred}개
              </p>
              <Button
                className={styles.retry}
                variant="quiet"
                disabled={!!pending || status.analysis.deferred === 0 || !isDesktop()}
                onClick={() => void run("retry_memory_analysis")}
              >
                보류된 분석 다시 시도
              </Button>
            </div>
            {status.analysis.legacyUnverified > 0 && (
              <p className={styles.caption}>
                이전 대화 {status.analysis.legacyUnverified}개는 분석 여부를 확인할 수 없어 자동으로
                다시 분석하지 않아요.
              </p>
            )}
          </>
        ) : (
          <p role="status">검색 설정을 불러오고 있어요.</p>
        )}
        {(error || fetchError) && (
          <p role="alert" className={s.error}>
            {error || fetchError}
          </p>
        )}
        {notice && (
          <p role="status" className={s.success}>
            {notice}
          </p>
        )}
      </div>
    </Surface>
  );
}
