import type { ReactElement } from "react";
import { Dialog } from "@comet/ui";
import { Button } from "../../ui";
import { text, type DataRecord } from "../toolData";
import { envelopeTitle } from "./DiaryEnvelope";
import { deviceTimeZone, eventsOn, eventTime, moveDay } from "./plannerData";
import * as s from "./diary.css";

export function DiaryEventDialog({
  event: selectedEvent,
  day,
  events,
  envelopes,
  saving,
  onSelect,
  onEdit,
  onOpenDay,
  onOpenEnvelope,
}: {
  event: DataRecord | null;
  day: string;
  events: DataRecord[];
  envelopes: DataRecord[];
  saving: boolean;
  onSelect: (event: DataRecord | null) => void;
  onEdit: (event: DataRecord) => void;
  onOpenDay: () => void;
  onOpenEnvelope: (id: string) => void;
}): ReactElement {
  return (
    <Dialog
      isOpen={Boolean(selectedEvent)}
      title={text(selectedEvent?.title) || "약속"}
      size="small"
      closeLabel="약속 닫기"
      onOpenChange={(open) => {
        if (!open) onSelect(null);
      }}
    >
      {selectedEvent && (
        <div className={s.form}>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {text(selectedEvent.title)}
          </p>
          <p>
            {selectedEvent.allDay
              ? `${text(selectedEvent.startDate)} ~ ${moveDay(text(selectedEvent.endDate) || text(selectedEvent.startDate), -1)} · 종일`
              : `${new Date(Number(selectedEvent.startAt)).toLocaleString("ko-KR")} ~ ${new Date(Number(selectedEvent.endAt)).toLocaleString("ko-KR")}`}{" "}
            · {deviceTimeZone()}
          </p>
          <p className={s.caption}>
            {selectedEvent.connectionId === "local"
              ? "Comet 일정"
              : text(selectedEvent.calendarName) || "연결된 캘린더 · 읽기 전용"}
          </p>
          {text(selectedEvent.location) && (
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              장소 · {text(selectedEvent.location)}
            </p>
          )}
          {text(selectedEvent.description) && (
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {text(selectedEvent.description)}
            </p>
          )}
          {selectedEvent.connectionId === "local" ? (
            <Button
              variant="secondary"
              disabled={saving || !events.some((event) => event.id === selectedEvent.id)}
              onClick={() => {
                const current = events.find((event) => event.id === selectedEvent.id);
                if (!current) return;
                onEdit(current);
                onSelect(null);
              }}
            >
              일정 편집
            </Button>
          ) : (
            <p className={s.caption}>외부 일정은 원본 캘린더에서 수정해요.</p>
          )}
          <section aria-label="선택 날짜 전체 일정" className={s.form}>
            <h3>{day} 전체 일정</h3>
            {eventsOn(events, day).map((event) => (
              <Button
                key={text(event.id)}
                variant="quiet"
                className={s.agendaEventButton}
                onClick={() => onSelect(event)}
              >
                {eventTime(event)} · {text(event.title)}
              </Button>
            ))}
          </section>
          <Button
            variant="primary"
            onClick={() => {
              onSelect(null);
              onOpenDay();
            }}
          >
            이날 펼치기
          </Button>
          {envelopes
            .filter((value) => value.eventId === selectedEvent.id)
            .map((value) => (
              <Button
                key={text(value.id)}
                variant="secondary"
                onClick={() => {
                  onSelect(null);
                  onOpenEnvelope(text(value.id));
                }}
              >
                {envelopeTitle(value)} ↗
              </Button>
            ))}
        </div>
      )}
    </Dialog>
  );
}
