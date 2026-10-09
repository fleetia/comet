import { Button, Dialog, FormField, Select } from "@fleetia/lagrange";
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
}: {
  data: DataRecord;
  act: ToolAction;
}): ReactElement {
  const [open, setOpen] = useState(false);
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
  return (
    <section className={s.appUsage} aria-label="프로그램 사용 시간">
      <span className={s.quiet}>앱 전면 사용</span>
      <strong className={s.appUsageName}>{target?.name || "선택한 프로그램 없음"}</strong>
      <span className={s.appUsageTime} role="timer" aria-label="프로그램 누적 사용 시간">
        {appUsageTime(usage?.elapsedMs || 0)}
      </span>
      <p className={s.quiet}>{label}</p>
      <Button
        variant="quiet"
        size="compact"
        disabled={!canEdit}
        title={!canEdit ? "집중이나 휴식을 마친 뒤 프로그램을 바꿀 수 있어요." : undefined}
        onClick={() => setOpen(true)}
      >
        {target ? "프로그램 변경" : "프로그램 선택"}
      </Button>
      {open && (
        <UsagePicker
          target={configured}
          canEdit={canEdit}
          act={act}
          onClose={() => setOpen(false)}
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
    <Dialog
      isOpen
      title="사용 시간 측정 프로그램"
      size="small"
      closeLabel="프로그램 선택 닫기"
      onOpenChange={(value) => {
        if (!value && !saving) onClose();
      }}
    >
      <div className={s.pane}>
        <p className={s.quiet}>
          집중 중 선택한 프로그램이 화면 맨 앞에 있고 최근 1분 안에 입력이 있을 때만 측정해요.
          백그라운드 실행 시간, 휴식과 일시정지는 제외해요. 창 제목이나 작업 내용은 읽거나 저장하지
          않아요.
        </p>
        {message && <p className={s.notice}>{message}</p>}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!canEdit && <p className={s.notice}>집중이나 휴식을 마친 뒤 프로그램을 바꿀 수 있어요.</p>}
        <FormField label="측정할 프로그램">
          <Select
            value={selectedId}
            disabled={!canEdit || loading || saving || !supported}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">측정하지 않음</option>
            {choices.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </Select>
        </FormField>
        {supported && !loading && applications.length === 0 && (
          <p className={s.quiet}>
            실행 중인 프로그램을 찾지 못했어요. 원하는 프로그램을 열고 새로고침해 주세요.
          </p>
        )}
        <div className={s.row}>
          <Button
            variant="quiet"
            disabled={loading || saving || !canEdit || !isDesktop()}
            onClick={() => void refresh()}
          >
            {loading ? "프로그램 확인 중…" : "프로그램 목록 새로고침"}
          </Button>
          {target && (
            <Button variant="quiet" disabled={saving || !canEdit} onClick={() => void save(null)}>
              사용 시간 측정 끄기
            </Button>
          )}
        </div>
        <div className={s.row}>
          <Button
            variant="primary"
            disabled={saving || loading || !canEdit || (!!selectedId && (!supported || !selected))}
            onClick={() => void save(selected || null)}
          >
            {saving ? "저장 중…" : "프로그램 선택 저장"}
          </Button>
          <Button variant="quiet" disabled={saving} onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
