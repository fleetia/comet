import type { ReactElement } from "react";
import { EnvelopeCard, Surface } from "@comet/ui";
import { localDay, record, rows, text } from "../toolData";
import type { WidgetView } from "../types";
import { envelopeTitle } from "../Planner/DiaryEnvelope";
import { frequencyRecords, ruleOf } from "../Planner/plannerData";
import * as s from "./preparationSettings.css";

export function PreparationSettingsPreview({
  widget,
  widgets,
  disabled,
  onOpen,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  disabled?: boolean;
  onOpen: () => void;
}): ReactElement {
  const envelopes = rows(record(widget.data).envelopes).filter((item) => !item.archived);
  const todos = rows(
    record(widgets.find((item) => item.kind === "todo" && item.installed && item.enabled)?.data)
      .items,
  );
  const events = rows(
    record(widgets.find((item) => item.kind === "calendar" && item.installed && item.enabled)?.data)
      .events,
  );
  return (
    <Surface variant="card" className={s.preview} aria-label="준비 봉투 미리보기">
      <h2 className={s.caption}>준비 중 · {envelopes.length}</h2>
      {envelopes.slice(0, 3).map((envelope) => {
        const checks = rows(envelope.checks);
        const ids = Array.isArray(envelope.todoIds) ? envelope.todoIds : [];
        const completed =
          checks.filter((check) => check.done === true).length +
          todos.filter(
            (item) =>
              ids.includes(item.id) &&
              (ruleOf(item).mode === "frequency"
                ? frequencyRecords(item, localDay()).some((entry) => entry.date === localDay())
                : typeof item.completedAt === "number"),
          ).length;
        const event = events.find((item) => item.id === envelope.eventId && !item.cancelled);
        const date =
          text(event?.startDate) ||
          (typeof event?.startAt === "number"
            ? localDay(new Date(event.startAt))
            : text(envelope.date));
        const description =
          date ||
          (envelope.eventId
            ? `${text(envelope.eventLabel)} · 일정 확인 필요`
            : "날짜 없이 준비 중");
        return (
          <EnvelopeCard
            key={text(envelope.id)}
            layout="preview"
            className={s.previewCard}
            title={envelopeTitle(envelope)}
            description={description}
            completed={completed}
            total={checks.length + ids.length}
            disabled={disabled}
            onClick={onOpen}
            aria-label={`${envelopeTitle(envelope)} · 준비 봉투 목록 열기`}
          />
        );
      })}
      {!envelopes.length && (
        <p className={s.caption}>준비할 일이 생기면 날짜 없이도 봉투를 만들 수 있어요.</p>
      )}
      {envelopes.length > 3 && (
        <p className={s.caption}>다이어리에서 나머지 {envelopes.length - 3}개도 볼 수 있어요.</p>
      )}
    </Surface>
  );
}
