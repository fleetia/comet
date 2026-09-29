import { useEffect, useState, type ReactElement } from "react";
import { Button, Checkbox, Heading, Inline, Text } from "@fleetia/lagrange";
import { command, errorText } from "../../hooks/useSnapshot";
import type { GeneratedWidget, GenerationEligibility } from "../GeneratedWidgets/types";
import * as common from "../../lagrange.css";
import * as styles from "./widgetManager.css";
import * as generatedStyles from "../GeneratedWidgets/generatedWidgets.css";

const ORIGIN = { manual: "AI 요청 제작", automatic: "AI 자동 제작", import: "JSON 가져오기" };

function installedTime(timestamp: number | null): ReactElement | string {
  if (timestamp === null) {
    return "기록 없음";
  }
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()}>{date.toLocaleString("ko-KR")}</time>;
}

export function GeneratedWidgetSettings({
  widget,
  eligibility,
  canAct,
  run,
  onRemove,
  onDirtyChange,
}: {
  widget: GeneratedWidget;
  eligibility: GenerationEligibility;
  canAct: boolean;
  run: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  onRemove: () => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}): ReactElement {
  const [request, setRequest] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    onDirtyChange(widget.id, request.length > 0);
  }, [widget.id, request, onDirtyChange]);
  useEffect(() => () => onDirtyChange(widget.id, false), [widget.id, onDirtyChange]);

  async function edit(): Promise<void> {
    if (!canAct || generating) {
      return;
    }
    setGenerating(true);
    setCancelError(null);
    setNotice("");
    try {
      const success = await run("generate_widget", {
        request,
        id: widget.id,
        expectedRevision: widget.revision,
      });
      if (success) {
        setRequest("");
        setNotice("위젯 창에서 실행을 확인하고 있어요. 오류가 있으면 AI가 이어서 수정해요.");
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={styles.detailContent}>
      <div className={styles.detailHeader}>
        <div>
          <Heading level={3} variant="subsection">
            {widget.definition.name}
          </Heading>
          <Text variant="caption" tone="muted">
            설치됨 · AI·가져온 위젯
          </Text>
        </div>
        <Button
          variant="primary"
          disabled={!canAct || !widget.enabled}
          onClick={() => void run("open_generated_widget", { id: widget.id })}
        >
          위젯 실행 ↗
        </Button>
      </div>
      <Text as="p" variant="caption" tone="muted">
        {widget.definition.description}. 실제 작업은 실행한 위젯에서 합니다.
      </Text>
      <Button
        variant="secondary"
        disabled={!canAct}
        onClick={() => void run("open_widget_state_rules", { id: widget.id })}
      >
        상태별 캐릭터 대사 편집
      </Button>
      {widget.error && (
        <Text as="p" role="alert" className={common.error}>
          {widget.error}
        </Text>
      )}
      {widget.status === "draft" && (
        <Text as="p" variant="caption" tone="muted">
          실행 검사를 기다리고 있어요. 위젯을 열어 확인할 수 있어요.
        </Text>
      )}
      <section className={styles.group}>
        <Heading level={4} variant="label">
          사용과 표시
        </Heading>
        <Checkbox
          checked={widget.enabled}
          disabled={!canAct}
          onChange={(event) =>
            void run("set_generated_widget_enabled", {
              id: widget.id,
              expectedRevision: widget.revision,
              enabled: event.target.checked,
            })
          }
        >
          위젯 사용
        </Checkbox>
        <Text as="p" variant="caption" tone="muted">
          실행 창을 닫아도 위젯 사용 상태는 유지됩니다.
        </Text>
      </section>
      <section className={styles.group}>
        <Heading level={4} variant="label">
          AI로 고치기
        </Heading>
        <Text as="p" variant="caption" tone="muted">
          {eligibility.reason}
        </Text>
        <label className={generatedStyles.field}>
          수정할 내용
          <textarea
            className={styles.editRequest}
            value={request}
            maxLength={2000}
            disabled={generating}
            onChange={(event) => setRequest(event.target.value)}
          />
        </label>
        <Inline gap="sm">
          <Button
            variant="primary"
            disabled={!canAct || !widget.enabled || !eligibility.allowed || !request.trim()}
            onClick={() => void edit()}
          >
            AI로 수정하기
          </Button>
          <Button
            variant="secondary"
            disabled={generating || !request}
            onClick={() => setRequest("")}
          >
            수정 입력 지우기
          </Button>
          {generating && (
            <Button
              variant="secondary"
              onClick={() => {
                void command("cancel_widget_generation").catch((cause) =>
                  setCancelError(errorText(cause)),
                );
              }}
            >
              제작 중단
            </Button>
          )}
        </Inline>
        {generating && (
          <Text as="p" role="status">
            AI가 수정하고 있어요…
          </Text>
        )}
        {cancelError && (
          <Text as="p" role="alert" className={common.error}>
            {cancelError}
          </Text>
        )}
        {notice && (
          <Text as="p" role="status">
            {notice}
          </Text>
        )}
      </section>
      <section className={styles.group}>
        <Heading level={4} variant="label">
          설치 정보
        </Heading>
        <dl className={styles.metadata}>
          <dt>설치 경로</dt>
          <dd>
            {widget.installation ? ORIGIN[widget.installation.origin] : "이전 설치 · 정보 없음"}
          </dd>
          <dt>최초 제작 모델</dt>
          <dd>{widget.installation?.model ?? "기록 없음"}</dd>
          <dt>설치일</dt>
          <dd>{installedTime(widget.installation?.installedAt ?? null)}</dd>
          <dt>정의 수정일</dt>
          <dd>{installedTime(widget.updatedAt)}</dd>
          <dt>저장 위치</dt>
          <dd>이 기기</dd>
          <dt>위젯 ID</dt>
          <dd>{widget.id}</dd>
        </dl>
        <details>
          <summary>위젯 코드와 공유 정의</summary>
          <textarea
            className={generatedStyles.source}
            readOnly
            aria-label={`${widget.definition.name} 공유 정의`}
            value={JSON.stringify(widget.definition, null, 2)}
          />
        </details>
        <div className={styles.remove}>
          <Heading level={4} variant="label">
            제거
          </Heading>
          <Button variant="critical" disabled={!canAct} onClick={onRemove}>
            위젯 제거
          </Button>
        </div>
        <Text as="p" variant="caption" tone="muted">
          제거해도 위젯 정의·작성 데이터·설치 정보는 이 기기에 보존합니다.
        </Text>
      </section>
    </div>
  );
}
