import { Button, Checkbox, Dialog } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import { PreparationTool } from "../PreparationTool/PreparationTool";
import { useConnectionCommand } from "../useConnectionCommand";
import { record, rows, text, localDay, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { eventTime, frequencyRecords, ruleOf } from "./plannerData";
import * as s from "./planner.css";

export function PlannerPreparation({
  event,
  calendar,
  preparation,
  widgets,
  act,
  openSettings,
}: {
  event?: DataRecord;
  calendar?: WidgetView;
  preparation?: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  openSettings: (kind?: string) => void;
}): ReactElement {
  const [opened, setOpened] = useState(false);
  const [saveError, setSaveError] = useState("");
  const save: ToolAction = async (action, input, target) => {
    setSaveError("");
    const ok = await act(action, input, target);
    if (!ok) setSaveError("저장하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.");
    return ok;
  };
  const { run, error, busy } = useConnectionCommand();
  const envelopes = rows(record(preparation?.data).envelopes);
  const envelope = envelopes.find((value) => value.eventId === event?.id);
  const connection = rows(record(calendar?.data).connections).find(
    (value) => value.id === event?.connectionId,
  );
  if (!event)
    return <p className={s.caption}>일정을 선택하면 준비할 일과 자료를 확인할 수 있어요.</p>;
  const linkedIds = Array.isArray(envelope?.todoIds) ? envelope.todoIds : [];
  const todo = widgets.find((w) => w.kind === "todo" && w.installed && w.enabled);
  const linkedTodos = rows(record(todo?.data).items).filter((item) =>
    linkedIds.includes(text(item.id)),
  );
  const filteredPreparation = preparation
    ? {
        ...preparation,
        data: { ...record(preparation.data), envelopes: envelope ? [envelope] : [] },
      }
    : undefined;
  return (
    <section className={s.section}>
      <h3 className={s.heading}>{text(event.title)} 준비</h3>
      <p className={s.caption}>
        {eventTime(event)} · {text(connection?.name)} · 읽기 전용
      </p>
      {connection?.status !== "ready" && (
        <p className={s.caption}>이전에 확인한 일정입니다. 준비 내용은 계속 편집할 수 있어요.</p>
      )}
      {rows(envelope?.checks).map((check) => (
        <Checkbox
          key={text(check.id)}
          checked={check.done === true}
          onChange={() =>
            void act(
              "check-toggle",
              { id: text(envelope?.id), checkId: text(check.id) },
              preparation,
            )
          }
        >
          {text(check.text)}
        </Checkbox>
      ))}
      {linkedTodos.map((item) => (
        <Checkbox
          key={text(item.id)}
          checked={
            ruleOf(item).mode === "frequency"
              ? frequencyRecords(item, localDay()).some((entry) => entry.date === localDay())
              : typeof item.completedAt === "number"
          }
          onChange={() =>
            void (() => {
              if (ruleOf(item).mode !== "frequency")
                return save(
                  typeof item.completedAt === "number" ? "undo" : "complete",
                  { id: text(item.id) },
                  todo,
                );
              const entry = frequencyRecords(item, localDay()).find(
                (value) => value.date === localDay(),
              );
              return save(
                entry ? "undo-frequency" : "record-frequency",
                {
                  id: text(item.id),
                  ...(entry ? { recordId: text(entry.id) } : { date: localDay() }),
                },
                todo,
              );
            })()
          }
        >
          {text(item.title)}
        </Checkbox>
      ))}
      <div className={s.actions}>
        {rows(envelope?.links).map((link) => (
          <Button
            key={text(link.id)}
            variant="secondary"
            size="compact"
            disabled={busy}
            onClick={() =>
              void run("open_widget_link", { id: preparation?.id, url: text(link.url) })
            }
          >
            {text(link.title)}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {preparation ? (
        <Button
          variant="quiet"
          size="compact"
          onClick={async () => {
            if (
              !envelope &&
              !(await act(
                "create",
                { eventId: text(event.id), eventLabel: text(event.title) },
                preparation,
              ))
            )
              return;
            setOpened(true);
          }}
        >
          {envelope ? "+ 준비 항목 · 자료 편집" : "준비 봉투 만들기"}
        </Button>
      ) : (
        <Button variant="quiet" size="compact" onClick={() => openSettings("preparation")}>
          준비 봉투 사용하기 ↗
        </Button>
      )}
      {text(event.url) && (
        <Button
          variant="quiet"
          size="compact"
          disabled={busy}
          onClick={() => void run("open_widget_link", { id: calendar?.id, url: text(event.url) })}
        >
          원본 일정 ↗
        </Button>
      )}
      <Dialog
        isOpen={opened}
        title={`${text(event.title)} 준비`}
        className={s.dialog}
        onOpenChange={setOpened}
        closeLabel="준비 편집 닫기"
      >
        {saveError && (
          <p role="alert" className={s.error}>
            {saveError}
          </p>
        )}
        {filteredPreparation && (
          <PreparationTool
            widget={filteredPreparation}
            widgets={widgets}
            act={(action, input) => save(action, input, preparation)}
          />
        )}
      </Dialog>
    </section>
  );
}
