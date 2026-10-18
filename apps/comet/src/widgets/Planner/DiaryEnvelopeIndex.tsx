import type { ReactElement } from "react";
import { EnvelopeCard } from "@comet/ui";
import { Surface } from "../../ui";
import { localDay, rows, text, type DataRecord } from "../toolData";
import { envelopeTitle } from "./DiaryEnvelope";
import type { DiaryTool } from "./diaryNavigation";
import { frequencyRecords, ruleOf } from "./plannerData";
import * as s from "./diary.css";
import * as envelopeStyles from "./diaryEnvelope.css";

export function DiaryEnvelopeIndex({
  collection,
  notesOpen,
  tool,
  envelopeId,
  envelopes,
  items,
  events,
  onOpenEnvelope,
}: {
  collection: "pages" | "envelopes" | null;
  notesOpen: boolean;
  tool: DiaryTool | null;
  envelopeId: string;
  envelopes: DataRecord[];
  items: DataRecord[];
  events: DataRecord[];
  onOpenEnvelope: (id: string) => void;
}): ReactElement {
  return (
    <Surface
      padding="compact"
      className={s.index}
      hidden={collection !== "envelopes" || notesOpen}
      role="navigation"
      aria-label={collection === "envelopes" ? "준비 봉투 목록" : "내 페이지 목록"}
    >
      <div hidden={collection !== "envelopes"}>
        <div className={envelopeStyles.envelopeGroups}>
          {[false, true].map((isArchived) => {
            const group = envelopes.filter((value) => Boolean(value.archived) === isArchived);
            return (
              <section
                key={String(isArchived)}
                id={`envelope-group-${isArchived ? "archived" : "preparing"}`}
                className={envelopeStyles.envelopeGroup}
                aria-label={isArchived ? "보관한 봉투" : "준비 중인 봉투"}
              >
                <h3 className={s.caption}>
                  {isArchived ? "보관함" : "준비 중"} · {group.length}
                </h3>
                {group.map((value) => {
                  const checks = rows(value.checks);
                  const linkedIds = Array.isArray(value.todoIds) ? value.todoIds : [];
                  const linked = items.filter((item) => linkedIds.includes(item.id));
                  const completed =
                    checks.filter((item) => item.done === true).length +
                    linked.filter((item) =>
                      ruleOf(item).mode === "frequency"
                        ? frequencyRecords(item, localDay()).some(
                            (entry) => entry.date === localDay(),
                          )
                        : typeof item.completedAt === "number",
                    ).length;
                  const event = events.find(
                    (event) => event.id === value.eventId && !event.cancelled,
                  );
                  const description = event
                    ? `${text(event.startDate) || (typeof event.startAt === "number" ? localDay(new Date(event.startAt)) : "일정에 연결됨")} · ${text(event.title)}`
                    : text(value.date) ||
                      (value.eventId
                        ? `${text(value.eventLabel)} · 일정 확인 필요`
                        : "날짜 없이 준비 중");
                  return (
                    <EnvelopeCard
                      key={text(value.id)}
                      className={envelopeStyles.envelopeCard}
                      title={envelopeTitle(value)}
                      description={isArchived ? `${description} · 보관함` : description}
                      completed={completed}
                      total={checks.length + linkedIds.length}
                      archived={isArchived}
                      selected={!tool && envelopeId === value.id}
                      aria-current={!tool && envelopeId === value.id ? "page" : undefined}
                      onClick={() => onOpenEnvelope(text(value.id))}
                    />
                  );
                })}
                {!group.length && (
                  <p className={s.caption}>
                    {isArchived
                      ? "아직 보관한 봉투가 없어요."
                      : "약속이 잡히기 전부터 할 일과 자료를 모아 두세요."}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </Surface>
  );
}
