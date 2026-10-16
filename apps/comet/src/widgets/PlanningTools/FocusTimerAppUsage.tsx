import { Button, FocusProgramPicker, IconButton } from "@comet/ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import {
  appUsageTime,
  readAppUsage,
  readUsageTarget,
  type FocusUsageTarget,
} from "./FocusTimerData";
import * as s from "./FocusTimer.css";

function usageStatus(status: string): string {
  switch (status) {
    case "tracking":
    case "active":
      return "선택한 프로그램 사용 중";
    case "idle":
      return "1분 이상 입력 없음 · 측정 멈춤";
    case "locked":
      return "화면 잠김 · 측정 멈춤";
    case "waiting":
      return "프로그램 사용 상태를 확인하고 있어요.";
    case "background":
    case "other-app":
      return "선택한 프로그램으로 전환하면 측정해요.";
    case "unsupported":
      return "이 환경에서는 프로그램 사용 시간을 측정할 수 없어요.";
    case "unavailable":
    case "error":
      return "사용 상태를 확인할 수 없어 측정을 멈췄어요.";
    default:
      return "확인된 사용 시간만 표시해요.";
  }
}

export function FocusTimerAppUsage({
  data,
  act,
  onPickerChange,
  pickerOpen,
  hideUnconfigured = false,
}: {
  data: DataRecord;
  act: ToolAction;
  onPickerChange?: (open: boolean) => void;
  pickerOpen?: boolean;
  hideUnconfigured?: boolean;
}): ReactElement {
  const [opened, setOpen] = useState(false);
  const open = pickerOpen ?? opened;
  const status = text(data.status) || "idle";
  const canEdit = status === "idle" || status === "finished";
  const configured = readUsageTarget(data.appUsageTarget);
  const active = readAppUsage(record(data.activeSession).appUsage);
  const previous = readAppUsage(rows(data.sessions).at(-1)?.appUsage);
  // Completed focus remains visible during its break. A new target starts at zero.
  const usage =
    active ||
    ((status === "finished" || data.mode === "rest") && previous?.target.id === configured?.id
      ? previous
      : undefined);
  const target = usage?.target || configured;
  const reportedStatus = usage?.status || text(data.appUsageStatus);
  const unavailable = ["unsupported", "unavailable", "error"].includes(reportedStatus);
  const label = !isDesktop()
    ? "데스크톱 앱에서 사용할 수 있어요."
    : !target
      ? "선택한 프로그램의 사용 시간을 따로 기록해요."
      : unavailable
        ? usageStatus(reportedStatus)
        : data.mode === "rest"
          ? "휴식 중 · 측정 멈춤"
          : status === "paused"
            ? "일시정지 중 · 측정 멈춤"
            : status === "finished"
              ? "이번 집중 측정 완료"
              : status === "idle"
                ? "집중을 시작하면 측정해요."
                : usageStatus(reportedStatus);
  function choose(value: boolean): void {
    setOpen(value);
    onPickerChange?.(value);
  }
  const measuring =
    status === "running" && data.mode !== "rest" && ["tracking", "active"].includes(reportedStatus);
  if (hideUnconfigured && !target && !open) return <></>;
  return (
    <section aria-label="프로그램 사용 시간" className={s.usageHost}>
      {!open && (
        <div className={s.usageCard}>
          <div className={s.usageHeading}>
            <span>앱 전면 사용</span>
            <div className={s.panelTools}>
              <button
                type="button"
                className={s.usageHelpButton}
                aria-label="무엇을 세나요"
                onClick={() => choose(true)}
              >
                ?
              </button>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="small"
                  className={s.usageChoose}
                  aria-label={target ? "프로그램 변경" : "프로그램 선택"}
                  onClick={() => choose(true)}
                >
                  {target ? "바꾸기…" : "고르기…"}
                </Button>
              )}
            </div>
          </div>
          <div className={s.usageStatus}>
            <span className={s.usageDot} data-active={measuring} />
            <strong>
              {unavailable
                ? "이 환경에서는 측정할 수 없어요"
                : status === "finished"
                  ? "이번 집중 측정 완료"
                  : measuring
                    ? `${target?.name} 사용 중`
                    : target?.name || "선택한 프로그램 없음"}
            </strong>
          </div>
          <div className={s.usageDescription}>
            {status === "finished" && target && <span>{target.name}</span>}
            <span role="timer" aria-label="프로그램 누적 사용 시간">
              {appUsageTime(usage?.elapsedMs || 0)}
            </span>
            <span> · {label}</span>
          </div>
        </div>
      )}
      {open && (
        <UsagePicker
          target={configured}
          canEdit={canEdit}
          act={act}
          onClose={() => choose(false)}
        />
      )}
    </section>
  );
}

function UsagePicker({
  target,
  canEdit,
  act,
  onClose,
}: {
  target: FocusUsageTarget | null;
  canEdit: boolean;
  act: ToolAction;
  onClose: () => void;
}): ReactElement {
  const [applications, setApplications] = useState<FocusUsageTarget[]>([]);
  const [selectedId, setSelectedId] = useState(target?.id || "");
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const fetching = useRef(false);
  const committing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  async function refresh(): Promise<void> {
    if (fetching.current) return;
    if (!isDesktop()) {
      setMessage("프로그램 선택과 사용 시간 측정은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    fetching.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await command<DataRecord>("list_usage_applications");
      if (!mounted.current) return;
      const seen = new Set<string>();
      setApplications(
        rows(result.applications).flatMap((item) => {
          const app = readUsageTarget(item);
          if (!app || seen.has(app.id)) return [];
          seen.add(app.id);
          return [app];
        }),
      );
      setSupported(result.supported === true);
      setMessage(
        text(result.message) ||
          (result.supported === true
            ? ""
            : "이 환경에서는 프로그램 사용 시간 측정을 지원하지 않아요."),
      );
    } catch (cause: unknown) {
      if (!mounted.current) return;
      setSupported(false);
      setError(`프로그램 목록을 불러오지 못했어요. ${errorText(cause)}`);
    } finally {
      fetching.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  const choices =
    target && !applications.some((app) => app.id === target.id)
      ? [target, ...applications]
      : applications;
  const selected = choices.find((app) => app.id === selectedId);
  async function save(next: FocusUsageTarget | null): Promise<void> {
    if (committing.current || !canEdit || (next && (!supported || loading))) return;
    committing.current = true;
    setSaving(true);
    setError("");
    try {
      const ok = await act("configure", { appUsageTarget: next });
      if (!mounted.current) return;
      if (ok) onClose();
      else setError("프로그램 선택을 저장하지 못했어요. 현재 선택을 확인한 뒤 다시 시도해 주세요.");
    } catch (cause: unknown) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      committing.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <section
      role="dialog"
      aria-label="사용 시간 측정 프로그램"
      data-focus-picker
      className={s.usagePicker}
    >
      <header className={s.cardHeader}>
        <IconButton
          icon="chevleft"
          variant="surface"
          aria-label="프로그램 선택 닫기"
          disabled={saving}
          onClick={onClose}
        />
        <h2 className={s.cardTitle}>측정할 프로그램</h2>
      </header>
      <div className={s.usagePickerBody}>
        {message && <p className={s.notice}>{message}</p>}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!canEdit && <p className={s.notice}>집중이나 휴식을 마친 뒤 프로그램을 바꿀 수 있어요.</p>}
        <FocusProgramPicker
          className={s.programChoices}
          label="측정할 프로그램"
          value={selectedId}
          disabled={!canEdit || loading || saving || !supported}
          options={[
            { value: "", label: "측정하지 않음" },
            ...choices.map((app) => ({ value: app.id, label: app.name })),
          ]}
          onValueChange={setSelectedId}
        />
        <p className={s.usageDescription}>
          맨 앞에서 1분 안에 입력할 때만 세요.
          <br />창 제목이나 내용은 읽지 않아요.
        </p>
        <details className={s.usageRules}>
          <summary>무엇을 세나요</summary>
          <div className={s.usageRulesBody}>
            <strong className={s.countedLabel}>세는 것</strong>
            <p>집중하는 동안 고른 프로그램이 맨 앞에 있고, 1분 안에 입력이 있었던 시간</p>
            <strong className={s.excludedLabel}>세지 않는 것</strong>
            <p>백그라운드 실행 시간, 휴식과 일시정지, 화면 잠금, 1분 넘게 입력이 없던 시간</p>
            <strong className={s.privateLabel}>저장하지 않는 것</strong>
            <p>
              창 제목이나 작업 내용은 읽거나 저장하지 않아요. 주소, 입력한 글자도 저장하지 않아요.
            </p>
            <p>짧게 바꾼 창은 놓칠 수 있어서 실제보다 조금 적게 나와요.</p>
          </div>
        </details>
        {supported && !loading && applications.length === 0 && (
          <p className={s.quiet}>
            실행 중인 프로그램을 찾지 못했어요. 원하는 프로그램을 열고 새로고침해 주세요.
          </p>
        )}
        <div className={s.timerActions}>
          <Button
            variant="ghost"
            size="small"
            className={s.linkAction}
            disabled={loading || saving || !canEdit || !isDesktop()}
            onClick={() => void refresh()}
          >
            {loading ? "프로그램 확인 중…" : "프로그램 목록 새로고침"}
          </Button>
          {target && (
            <Button
              variant="ghost"
              size="small"
              disabled={saving || !canEdit}
              onClick={() => void save(null)}
            >
              사용 시간 측정 끄기
            </Button>
          )}
        </div>
        <div className={s.timerActions}>
          <Button
            variant="primary"
            className={s.primaryAction}
            disabled={saving || loading || !canEdit || (!!selectedId && (!supported || !selected))}
            onClick={() => void save(selected || null)}
          >
            {saving ? "저장 중…" : "프로그램 선택 저장"}
          </Button>
          <Button variant="ghost" size="small" disabled={saving} onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </section>
  );
}
