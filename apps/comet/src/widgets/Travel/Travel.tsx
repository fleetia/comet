import { useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Select, SidebarItem } from "@comet/ui";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { record, rows, text, type DataRecord } from "../toolData";
import { useDiary } from "../Planner/useDiary";
import { useDiaryWidgetActions } from "../Planner/useDiaryWidgetActions";
import { useDiaryCreation } from "../Planner/useDiaryCreation";
import { envelopeTitle } from "../Planner/DiaryEnvelope";
import { preparationProgress } from "../PreparationTool/preparationData";
import * as diary from "../Planner/diary.css";
import { NEW_ENVELOPE, TravelEditor, type TravelDraft } from "./TravelEditor";
import { TravelPlanEditor } from "./TravelPlanEditor";
import { TravelOverview } from "./TravelOverview";
import { TravelSchedule } from "./TravelSchedule";
import {
  HOME_ZONE,
  STAGE_LABELS,
  countdown,
  dateIn,
  dayLabel,
  periodLabel,
  sortTravels,
  travelDays,
  travelStage,
  zoneNote,
} from "./travelData";
import type { Travel as TravelValue, TravelPlan, TravelTab } from "./travelTypes";
import * as s from "./travel.css";

type Editing =
  | { kind: "travel"; travel?: TravelValue }
  | { kind: "plan"; plan?: TravelPlan; date: string }
  | null;

const TABS: [TravelTab, string, "today" | "calendar"][] = [
  ["overview", "한눈에", "calendar"],
  ["schedule", "일정", "today"],
];

export function Travel(): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const state = useDiary();
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(location.search).get("id") ?? "",
  );
  const [tab, setTab] = useState<TravelTab>(() =>
    location.hash === "#schedule" ? "schedule" : "overview",
  );
  const [day, setDay] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const widgets = snapshot?.widgets ?? [];
  const enabled = (kind: string) =>
    widgets.find((widget) => widget.kind === kind && widget.installed && widget.enabled);
  const todo = enabled("todo");
  const envelopes = rows(record(enabled("preparation")?.data).envelopes);
  const items = rows(record(todo?.data).items);
  const actions = useDiaryWidgetActions({ snapshot, todo, reload, setFailure });
  const createdEnvelope = useRef<string | null>(null);
  const envelopeRequest = useRef<string | null>(null);
  const creation = useDiaryCreation({
    actions,
    mutate: state.mutate,
    page: undefined,
    day: "",
    reload,
    onPageCreated: () => undefined,
    onEnvelopeCreated: (id) => {
      createdEnvelope.current = id;
    },
  });
  const travels = sortTravels(state.state?.travels ?? []);
  const travel = travels.find((value) => value.id === selectedId) ?? travels[0];
  const plans = (state.state?.travelPlans ?? []).filter((plan) => plan.travelId === travel?.id);
  const days = travel ? travelDays(travel, plans) : [];
  const shownDay = days.includes(day) ? day : (days[0] ?? "");
  const busy = state.busy || actions.busy;
  const linked = travel?.envelopeId
    ? envelopes.find((value) => value.id === travel.envelopeId)
    : undefined;

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    void listen<string>("travel-open", (event) => {
      setSelectedId(event.payload);
      setTab("overview");
    }).then((unlisten) => {
      if (active) cleanup = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  function openDay(date: string): void {
    setDay(date);
    setTab("schedule");
  }

  async function saveTravel(draft: TravelDraft): Promise<boolean> {
    const current = editing?.kind === "travel" ? editing.travel : undefined;
    let envelopeId: string | null = draft.envelopeId || null;
    if (envelopeId === NEW_ENVELOPE) {
      if (!createdEnvelope.current) {
        envelopeRequest.current ??= crypto.randomUUID();
        const outcome = await creation.createEnvelope(
          { title: draft.title.trim(), date: draft.startDate, checks: [], tasks: [], reminderDays: null },
          envelopeRequest.current,
        );
        if (outcome !== "created" || !createdEnvelope.current) return false;
      }
      envelopeId = createdEnvelope.current;
    }
    const saved = await state.mutate(current ? "travel-update" : "travel-create", {
      ...draft,
      envelopeId,
      ...(current ? { id: current.id, expected: current, finished: current.finished } : {}),
    });
    if (!saved) return false;
    createdEnvelope.current = null;
    envelopeRequest.current = null;
    if (!current) {
      const created = saved.travels?.at(-1);
      if (created) setSelectedId(created.id);
      setTab("overview");
    }
    return true;
  }

  async function finish(finished: boolean): Promise<void> {
    if (!travel) return;
    const { id, finished: _, ...fields } = travel;
    await state.mutate("travel-update", {
      ...fields,
      envelopeId: fields.envelopeId ?? null,
      id,
      expected: travel,
      finished,
    });
  }

  const close = (): void => {
    if (isDesktop())
      void getCurrentWindow()
        .destroy()
        .catch((cause: unknown) => setFailure(errorText(cause)));
  };

  return (
    <main className={diary.window}>
      {(failure || state.error || loadError) && (
        <div role="alert" className={diary.error}>
          {failure || state.error || loadError}
        </div>
      )}
      {!state.state ? (
        <p role="status" className={s.status}>
          여행을 펼치고 있어요.
        </p>
      ) : (
        <div className={s.layout}>
          <nav className={diary.rail} aria-label="여행 창의 칸">
            <WindowHeader
              nativeControls
              className={diary.railHeader}
              label="여행 창 닫기"
              onClose={async () => close()}
            />
            <span className={s.brand}>comet</span>
            {travel &&
              TABS.map(([value, label, icon]) => (
                <SidebarItem
                  key={value}
                  href={`#${value}`}
                  icon={icon}
                  current={tab === value}
                  onClick={(event) => {
                    event.preventDefault();
                    setTab(value);
                  }}
                >
                  {label}
                </SidebarItem>
              ))}
          </nav>
          <div className={s.main}>
            {travel ? (
              <>
                <header className={s.header}>
                  <div className={s.headerText}>
                    <h1 className={s.travelTitle}>{travel.title}</h1>
                    <p className={s.caption}>
                      {periodLabel(travel)}
                      {travel.destination && ` · ${travel.destination}`}
                      {travel.timeZone === HOME_ZONE
                        ? " / 한국 시각"
                        : ` / 그곳 시각 · ${zoneNote(travel.timeZone)}`}
                    </p>
                  </div>
                  <div className={s.actions}>
                    {travels.length > 1 && (
                      <Select
                        aria-label="여행 바꾸기"
                        value={travel.id}
                        onChange={(event) => {
                          setSelectedId(event.target.value);
                          setTab("overview");
                        }}
                      >
                        {travels.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.title} · {STAGE_LABELS[travelStage(value)]}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditing({ kind: "travel", travel })}
                    >
                      고치기
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditing({ kind: "travel" })}
                    >
                      새 여행
                    </Button>
                  </div>
                </header>
                {tab === "overview" ? (
                  <TravelOverview
                    travel={travel}
                    plans={plans}
                    envelope={
                      linked
                        ? { title: envelopeTitle(linked), ...preparationProgress(linked, items) }
                        : null
                    }
                    busy={busy}
                    onOpenDay={openDay}
                    onOpenEnvelope={() =>
                      void command("open_planner_view", {
                        tab: "envelopes",
                        entity: "envelope",
                        targetId: text(linked?.id),
                      }).catch((cause: unknown) => setFailure(errorText(cause)))
                    }
                    onFinish={(finished) => void finish(finished)}
                  />
                ) : (
                  <TravelSchedule
                    travel={travel}
                    plans={plans}
                    days={days}
                    date={shownDay}
                    busy={busy}
                    onSelectDay={setDay}
                    onAdd={() => setEditing({ kind: "plan", date: shownDay })}
                    onEdit={(plan) => setEditing({ kind: "plan", plan, date: plan.date })}
                  />
                )}
                <p className={s.footer}>
                  {STAGE_LABELS[travelStage(travel)]}
                  {travelStage(travel) !== "done" && travelStage(travel) !== "wrapping"
                    ? ` · ${countdown(travel)}`
                    : ""}
                  {travel.timeZone !== HOME_ZONE &&
                    ` · 그곳은 ${dayLabel(dateIn(travel.timeZone))}`}
                </p>
              </>
            ) : (
              <div className={s.empty}>
                <h1 className={s.pageTitle}>아직 여행이 없어요</h1>
                <p className={s.caption}>
                  여행을 만들면 날짜별 일정과 준비 봉투를 한곳에서 챙길 수 있어요.
                </p>
                <Button disabled={busy} onClick={() => setEditing({ kind: "travel" })}>
                  새 여행 만들기
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {editing?.kind === "travel" && (
        <TravelEditor
          travel={editing.travel}
          envelopes={envelopes}
          busy={busy}
          onSave={saveTravel}
          onDelete={
            editing.travel
              ? async () =>
                  Boolean(
                    await state.mutate("travel-delete", {
                      id: editing.travel?.id,
                      expected: editing.travel,
                    } as DataRecord),
                  )
              : undefined
          }
          onClose={() => {
            createdEnvelope.current = null;
            envelopeRequest.current = null;
            setEditing(null);
          }}
        />
      )}
      {editing?.kind === "plan" && travel && (
        <TravelPlanEditor
          travel={travel}
          plan={editing.plan}
          date={editing.date}
          busy={busy}
          onSave={async (input) =>
            Boolean(await state.mutate(editing.plan ? "travel-plan-update" : "travel-plan-create", input))
          }
          onDelete={
            editing.plan
              ? async () =>
                  Boolean(
                    await state.mutate("travel-plan-delete", {
                      id: editing.plan?.id,
                      expected: editing.plan,
                    } as DataRecord),
                  )
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
