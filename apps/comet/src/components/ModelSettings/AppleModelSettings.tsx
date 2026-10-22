import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { ShieldIcon } from "@comet/icon";
import { Button, SettingControlRow, Switch } from "@comet/ui";
import type { AppleModelStatus } from "../../types";
import type { SettingsDraft } from "../../hooks/useSettingsDraft";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as common from "../../common.css";
import * as figma from "../SettingsPanel/figmaSettings.css";
import * as styles from "./aiSettings.css";

type Props = {
  initialStatus: AppleModelStatus;
  draft: SettingsDraft;
  inspectorHeader: ReactNode;
  supportingContent: ReactNode;
  footer?: ReactNode;
  automaticDraft?: SettingsDraft;
  automaticFooter?: ReactNode;
};

export function AppleModelSettings({
  initialStatus,
  draft,
  inspectorHeader,
  supportingContent,
  footer,
  automaticDraft,
  automaticFooter,
}: Props): JSX.Element {
  const [status, setStatus] = useState(initialStatus);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const loading = useRef(false);
  const operation = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    if (!isDesktop() || loading.current) {
      return;
    }
    const version = ++operation.current;
    loading.current = true;
    setChecking(true);
    setError(null);
    try {
      const next = await command<AppleModelStatus>("apple_model_status");
      if (mounted.current && version === operation.current) {
        setStatus(next);
      }
    } catch (cause) {
      if (mounted.current && version === operation.current) {
        setError(errorText(cause));
      }
    } finally {
      if (version === operation.current) {
        loading.current = false;
        if (mounted.current) {
          setChecking(false);
        }
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    function recheck(): void {
      if (!document.hidden) {
        void refresh();
      }
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      mounted.current = false;
      operation.current += 1;
      loading.current = false;
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refresh]);
  const available = status.available && !error;
  const busy = Boolean(checking || draft.pending);
  return (
    <div className={figma.split}>
      <aside className={figma.inspector}>
        {inspectorHeader}
        <div className={styles.connectionStatus}>
          <strong>
            {checking ? "사용 가능 상태 확인 중…" : available ? "사용 가능" : "사용 준비 필요"}
          </strong>
          <p className={figma.caption} role="status">
            {error ? "사용 가능 상태를 다시 확인해 주세요." : status.message}
          </p>
          <Button
            variant="ghost"
            size="small"
            disabled={busy || !isDesktop()}
            onClick={() => void refresh()}
          >
            다시 확인
          </Button>
        </div>
        <div className={figma.note}>
          <ShieldIcon size={16} />
          <p className={figma.caption}>
            Apple이 제공하는 모델로 기기 안에서 처리해요. 대화와 기억을 다른 AI로 자동 전송하지
            않아요.
          </p>
        </div>
        <p className={figma.caption}>
          모델 준비는 macOS가 관리해요. OS의 Apple Intelligence 상태와 언어 지원을 확인한 뒤 다시
          확인해 주세요.
        </p>
        {error && (
          <p role="alert" className={common.error}>
            {error}
          </p>
        )}
      </aside>
      <div className={figma.right}>
        <section className={figma.section}>
          <h2 className={figma.sectionTitle}>Apple 온디바이스 AI</h2>
          <div className={figma.group}>
            <SettingControlRow
              className={figma.row}
              title="지원 기능"
              description="짧은 캐릭터 대화 · 요약 · 추출을 위한 텍스트 경로예요. 한국어 응답 품질은 아직 평가 중이에요."
              control={<span className={figma.caption}>한국어 · {status.locale}</span>}
            />
            <SettingControlRow
              className={figma.row}
              title="지원하지 않는 요청"
              description="위젯 코드 생성, 이미지·첨부파일, 긴 문맥과 복잡한 추론은 지원하지 않아요. 다른 AI는 직접 선택해 주세요."
              control={null}
            />
            <SettingControlRow
              className={figma.row}
              title="응답 확인"
              description="고정된 인사 요청으로 확인해요. 설정을 저장하거나 대화 기록을 전송하지 않아요."
              control={
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy || !available || !isDesktop()}
                  onClick={() => void draft.run("test_apple_model")}
                >
                  {draft.pending === "test_apple_model" ? "확인 중…" : "확인하기"}
                </Button>
              }
            />
          </div>
          <p className={figma.caption}>
            응답 확인만으로 사용하는 AI가 바뀌지는 않아요. AI 연결을 저장하면 전환해요.
          </p>
        </section>
        {automaticDraft && (
          <section className={figma.section}>
            <h2 className={figma.sectionTitle}>자동 잡담</h2>
            <div className={figma.group}>
              <SettingControlRow
                className={figma.row}
                title="Apple AI로 새 잡담 만들기"
                description="처음에는 꺼져 있어요 · 대화 설정에서도 바꿀 수 있어요"
                control={
                  <Switch
                    aria-label="Apple AI로 새 잡담 만들기"
                    checked={automaticDraft.settings.appleIdleEnabled}
                    disabled={Boolean(automaticDraft.pending)}
                    onChange={(event) =>
                      automaticDraft.change("appleIdleEnabled", event.target.checked)
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
}
