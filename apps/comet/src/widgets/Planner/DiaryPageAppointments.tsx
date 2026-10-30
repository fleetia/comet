import { Button, Surface } from "@comet/ui";
import type { ReactElement } from "react";
import { text } from "../toolData";
import type { DiaryPageProps } from "./DiaryPage";
import { envelopeTitle, type DiaryPageData } from "./diaryPageData";
import { eventTime } from "./plannerData";
import type { DiaryPageDraft } from "./useDiaryPageDraft";
import * as s from "./diaryPage.css";

export function DiaryPageAppointments({
  source: { envelopes, onOpenEnvelope, onOpenEvent },
  data: { dayEvents, dayEnvelopes },
  draft: { disabled },
}: {
  source: Pick<DiaryPageProps, "envelopes" | "onOpenEnvelope" | "onOpenEvent">;
  data: Pick<DiaryPageData, "dayEvents" | "dayEnvelopes">;
  draft: Pick<DiaryPageDraft, "disabled">;
}): ReactElement | null {
  if (!dayEvents.length && !dayEnvelopes.length) return null;
  return (
    <div className={s.appointments} role="region" aria-label="오늘의 약속">
      {dayEvents.map((event) => (
        <Surface
          variant="card"
          key={`event:${text(event.id)}`}
          className={s.appointment}
          aria-label={`${event.connectionId === "local" ? "Comet 일정" : "연결 일정"}: ${text(event.title)}`}
        >
          <div className={s.appointmentContent}>
            <p className={s.title}>
              {eventTime(event)} · {text(event.title)}
            </p>
            <span className={s.meta}>
              {event.connectionId === "local" ? "Comet 일정" : "연결 일정 · 읽기 전용"}
            </span>
          </div>
          <div className={s.row}>
            {onOpenEvent && (
              <Button variant="ghost" size="small" onClick={() => onOpenEvent(event)}>
                일정 보기
              </Button>
            )}
            {envelopes
              .filter((envelope) => envelope.eventId === event.id && envelope.archived !== true)
              .map((envelope) => (
                <Button
                  key={text(envelope.id)}
                  variant="ghost"
                  size="small"
                  onClick={() => onOpenEnvelope(text(envelope.id))}
                >
                  {envelopeTitle(envelope)} 열기 ↗
                </Button>
              ))}
          </div>
        </Surface>
      ))}
      {dayEnvelopes.map((envelope) => (
        <Surface
          variant="card"
          key={`envelope:${text(envelope.id)}`}
          className={s.appointment}
          aria-label={`준비 봉투: ${envelopeTitle(envelope)}`}
        >
          <div className={s.appointmentContent}>
            <p className={s.title}>{envelopeTitle(envelope)}</p>
            <span className={s.meta}>이날 준비할 봉투</span>
          </div>
          <Button
            variant="ghost"
            size="small"
            disabled={disabled}
            onClick={() => onOpenEnvelope(text(envelope.id))}
          >
            {envelopeTitle(envelope)} 열기 ↗
          </Button>
        </Surface>
      ))}
    </div>
  );
}
