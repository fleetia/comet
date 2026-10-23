import { useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { IconName } from "@comet/icon";
import { Button, Select, SidebarItem } from "@comet/ui";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { record, rows, text, type DataRecord } from "../toolData";
import { useDiary } from "../Planner/useDiary";
import { useDiaryWidgetActions } from "../Planner/useDiaryWidgetActions";
import { useDiaryCreation } from "../Planner/useDiaryCreation";
import { envelopeTitle } from "../Planner/DiaryEnvelope";
import { LEDGER_CATEGORIES } from "../Planner/diaryLedgerTypes";
import { preparationProgress } from "../PreparationTool/preparationData";
import * as diary from "../Planner/diary.css";
import { NEW_ENVELOPE, TravelEditor, type TravelDraft } from "./TravelEditor";
import { TravelPlanEditor } from "./TravelPlanEditor";
import { TravelOverview } from "./TravelOverview";
import { TravelSchedule } from "./TravelSchedule";
import { TravelBookings } from "./TravelBookings";
import { TravelBookingEditor, type BookingDraft } from "./TravelBookingEditor";
import { TravelCosts } from "./TravelCosts";
import { TravelExpenseEditor } from "./TravelExpenseEditor";
import { TravelPeople } from "./TravelPeople";
import { TravelMap, placeInput } from "./TravelMap";
import { TravelPhotos } from "./TravelPhotos";
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
import { tripPage } from "./travelSummary";
import type {
  Booking,
  Expense,
  Travel as TravelValue,
  TravelPlan,
  TravelSettings,
  TravelTab,
  TripData,
  Voucher,
} from "./travelTypes";
import * as s from "./travel.css";

type Editing =
  | { kind: "travel"; travel?: TravelValue }
  | { kind: "plan"; plan?: TravelPlan; date: string }
  | { kind: "booking"; booking?: Booking; draft?: BookingDraft }
  | { kind: "expense"; expense?: Expense }
  | null;

const TABS: [TravelTab, string, IconName][] = [
  ["overview", "한눈에", "calendar"],
  ["schedule", "일정", "today"],
  ["bookings", "예약", "link"],
  ["costs", "비용", "coin"],
  ["people", "사람", "together"],
  ["map", "지도", "pin"],
  ["photos", "사진", "image"],
];
const DEFAULT_SETTINGS: TravelSettings = { mapTiles: false, addressSearch: false };

function initialTab(): TravelTab {
  const hash = location.hash.slice(1);
  return TABS.some(([tab]) => tab === hash) ? (hash as TravelTab) : "overview";
}

export function Travel({ onClose }: { onClose?: () => void } = {}): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const state = useDiary();
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get("id") ?? "");
  const [tab, setTab] = useState<TravelTab>(initialTab);
  const [day, setDay] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [drafting, setDrafting] = useState(false);
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
  const data = state.state;
  const travels = sortTravels(data?.travels ?? []);
  const travel = travels.find((value) => value.id === selectedId) ?? travels[0];
  const of = <T extends { travelId: string }>(list: T[] | undefined) =>
    (list ?? []).filter((value) => value.travelId === travel?.id);
  const trip: TripData | null = travel
    ? {
        travel,
        plans: of(data?.travelPlans),
        bookings: of(data?.travelBookings),
        expenses: of(data?.travelExpenses),
        people: of(data?.travelPeople),
        transfers: of(data?.travelTransfers),
        photos: of(data?.travelPhotos),
      }
    : null;
  const settings = data?.travelSettings ?? DEFAULT_SETTINGS;
  const categories = data?.ledgerSettings?.categories ?? LEDGER_CATEGORIES;
  const days = trip ? travelDays(trip.travel, trip.plans) : [];
  const shownDay = days.includes(day) ? day : (days[0] ?? "");
  const busy = state.busy || actions.busy;
  const today = travel ? dateIn(travel.timeZone) : "";
  const linked = travel?.envelopeId ? envelopes.find((value) => value.id === travel.envelopeId) : undefined;

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    let received = false;
    const select = (id: string | null): void => {
      if (!active) return;
      setSelectedId(id ?? "");
      setTab("overview");
      setBookingId("");
    };
    void listen<string | null>("travel-open", (event) => {
      received = true;
      select(event.payload);
    }).then(async (unlisten) => {
      if (!active) { unlisten(); return; }
      cleanup = unlisten;
      const id = await command<string | null>("get_travel_target");
      if (!received) select(id);
    }).catch((cause: unknown) => {
      if (active) setFailure(errorText(cause));
    });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  const run = async (action: string, input: DataRecord) => Boolean(await state.mutate(action, input));

  function open(next: TravelTab): void {
    setTab(next);
    if (next !== "bookings") setBookingId("");
  }
  function openDay(date: string): void {
    setDay(date);
    open("schedule");
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
      open("overview");
    }
    return true;
  }

  async function finish(finished: boolean): Promise<void> {
    if (!travel) return;
    const { id, finished: _, ...fields } = travel;
    await run("travel-update", { ...fields, envelopeId: fields.envelopeId ?? null, id, expected: travel, finished });
  }

  async function draftBooking(): Promise<void> {
    if (!travel) return;
    setDrafting(true);
    setFailure(null);
    try {
      const result = await command<{ draft: Record<string, string>; voucher: Voucher } | null>(
        "travel_booking_draft",
        { travelId: travel.id },
      );
      if (result) setEditing({ kind: "booking", draft: { ...result.draft, voucher: result.voucher } });
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setDrafting(false);
    }
  }

  async function exportPage(): Promise<void> {
    if (!trip) return;
    try {
      const path = await command<string>("travel_write_page", { travelId: trip.travel.id, markdown: tripPage(trip) });
      setNotice(`여행 페이지를 만들었어요 · ${path}`);
    } catch (cause) {
      setFailure(errorText(cause));
    }
  }

  const close = (): void => {
    if (onClose) { onClose(); return; }
    if (isDesktop())
      void getCurrentWindow()
        .destroy()
        .catch((cause: unknown) => setFailure(errorText(cause)));
  };

  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (!active) return;
      event.preventDefault();
      closeRef.current();
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch((cause: unknown) => {
      if (active) setFailure(errorText(cause));
    });
    return () => { active = false; unlisten?.(); };
  }, []);

  const body = (current: TripData): ReactElement => {
    switch (tab) {
      case "schedule":
        return (
          <TravelSchedule
            travel={current.travel}
            plans={current.plans}
            bookings={current.bookings}
            days={days}
            date={shownDay}
            busy={busy}
            onSelectDay={setDay}
            onAdd={() => setEditing({ kind: "plan", date: shownDay })}
            onEdit={(plan) => setEditing({ kind: "plan", plan, date: plan.date })}
          />
        );
      case "bookings":
        return (
          <TravelBookings
            trip={current}
            selectedId={bookingId}
            busy={busy || drafting}
            onSelect={setBookingId}
            onAdd={() => setEditing({ kind: "booking" })}
            onDraft={() => void draftBooking()}
            onEdit={(booking) => setEditing({ kind: "booking", booking })}
            onFailure={setFailure}
          />
        );
      case "costs":
        return (
          <TravelCosts
            trip={current}
            busy={busy}
            onAdd={() => setEditing({ kind: "expense" })}
            onEdit={(expense) => setEditing({ kind: "expense", expense })}
            onSent={(from, to, amount) =>
              void run("travel-transfer-create", { travelId: current.travel.id, from, to, amount, date: today })
            }
            onUndoSent={(transfer) => void run("travel-transfer-delete", { id: transfer.id, expected: transfer })}
          />
        );
      case "people":
        return (
          <TravelPeople
            trip={current}
            busy={busy}
            onSave={(input, person) =>
              run(
                person ? "travel-person-update" : "travel-person-create",
                person ? { ...input, id: person.id, expected: person } : { ...input, travelId: current.travel.id },
              )
            }
            onDelete={(person) => run("travel-person-delete", { id: person.id, expected: person })}
            onSettle={() => open("costs")}
          />
        );
      case "map":
        return (
          <TravelMap
            trip={current}
            days={days}
            settings={settings}
            busy={busy}
            onSettings={(next) => void run("travel-settings-update", { ...next, expected: settings })}
            onPlace={(plan, at) => run("travel-plan-update", placeInput(plan, at) as DataRecord)}
            onOpenDay={openDay}
          />
        );
      case "photos":
        return (
          <TravelPhotos trip={current} busy={busy} mutate={run} onOverview={() => open("overview")} onFailure={setFailure} />
        );
      default:
        return (
          <TravelOverview
            trip={current}
            days={days}
            envelope={linked ? { title: envelopeTitle(linked), ...preparationProgress(linked, items) } : null}
            busy={busy}
            onOpen={open}
            onOpenDay={openDay}
            onOpenBooking={(id) => {
              setBookingId(id);
              setTab("bookings");
            }}
            onOpenEnvelope={() =>
              void command("open_planner_view", {
                tab: "envelopes",
                entity: "envelope",
                targetId: text(linked?.id),
              }).catch((cause: unknown) => setFailure(errorText(cause)))
            }
            onFinish={(finished) => void finish(finished)}
            onExport={() => void exportPage()}
          />
        );
    }
  };

  return (
    <main className={diary.window}>
      {(failure || state.error || loadError) && (
        <div role="alert" className={diary.error}>
          {failure || state.error || loadError}
        </div>
      )}
      {notice && (
        <div role="status" className={diary.status}>
          {notice}
        </div>
      )}
      {!data ? (
        <p role="status" className={s.status}>
          여행을 펼치고 있어요.
        </p>
      ) : (
        <div className={s.layout}>
          <nav className={diary.rail} aria-label="여행 창의 칸">
            <WindowHeader nativeControls className={diary.railHeader} label="여행 창 닫기" onClose={async () => close()} />
            <span className={s.brand}>comet</span>
            {trip &&
              TABS.map(([value, label, icon]) => (
                <SidebarItem
                  key={value}
                  href={`#${value}`}
                  icon={icon}
                  current={tab === value}
                  onClick={(event) => {
                    event.preventDefault();
                    open(value);
                  }}
                >
                  {label}
                </SidebarItem>
              ))}
          </nav>
          <div className={s.main}>
            {trip ? (
              <>
                <header className={s.header}>
                  <div className={s.headerText}>
                    <h1 className={s.travelTitle}>{trip.travel.title}</h1>
                    <p className={s.caption}>
                      {periodLabel(trip.travel)}
                      {trip.people.length ? ` · ${trip.people.length + 1}명` : ""}
                      {trip.travel.destination && ` · ${trip.travel.destination}`}
                      {trip.travel.timeZone === HOME_ZONE
                        ? " / 한국 시각"
                        : ` / 그곳 시각 · ${zoneNote(trip.travel.timeZone)}`}
                    </p>
                  </div>
                  <div className={s.actions}>
                    {travels.length > 1 && (
                      <Select
                        aria-label="여행 바꾸기"
                        value={trip.travel.id}
                        onChange={(event) => {
                          setSelectedId(event.target.value);
                          open("overview");
                        }}
                      >
                        {travels.map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.title} · {STAGE_LABELS[travelStage(value)]}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Button variant="ghost" disabled={busy} onClick={() => setEditing({ kind: "travel", travel: trip.travel })}>
                      고치기
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setEditing({ kind: "travel" })}>
                      새 여행
                    </Button>
                  </div>
                </header>
                {body(trip)}
                <p className={s.footer}>
                  {STAGE_LABELS[travelStage(trip.travel)]}
                  {!["done", "wrapping"].includes(travelStage(trip.travel)) ? ` · ${countdown(trip.travel)}` : ""}
                  {trip.travel.timeZone !== HOME_ZONE && ` · 그곳은 ${dayLabel(dateIn(trip.travel.timeZone))}`}
                  {drafting && " · 확인서를 읽고 있어요"}
                </p>
              </>
            ) : (
              <div className={s.empty}>
                <h1 className={s.pageTitle}>아직 여행이 없어요</h1>
                <p className={s.caption}>여행을 만들면 일정·예약·비용·사진을 한곳에서 챙길 수 있어요.</p>
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
              ? () => run("travel-delete", { id: editing.travel?.id, expected: editing.travel } as DataRecord)
              : undefined
          }
          onClose={() => {
            createdEnvelope.current = null;
            envelopeRequest.current = null;
            setEditing(null);
          }}
        />
      )}
      {editing?.kind === "plan" && trip && (
        <TravelPlanEditor
          travel={trip.travel}
          bookings={trip.bookings}
          plan={editing.plan}
          date={editing.date}
          busy={busy}
          onSave={(input) => run(editing.plan ? "travel-plan-update" : "travel-plan-create", input)}
          onDelete={
            editing.plan
              ? () => run("travel-plan-delete", { id: editing.plan?.id, expected: editing.plan } as DataRecord)
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "booking" && trip && (
        <TravelBookingEditor
          trip={trip}
          booking={editing.booking}
          draft={editing.draft}
          categories={categories}
          busy={busy}
          today={today}
          onSave={(input) => run(editing.booking ? "travel-booking-update" : "travel-booking-create", input)}
          onDelete={
            editing.booking
              ? async () => {
                  const done = await run("travel-booking-delete", { id: editing.booking?.id, expected: editing.booking } as DataRecord);
                  if (done) setBookingId("");
                  return done;
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "expense" && trip && (
        <TravelExpenseEditor
          trip={trip}
          expense={editing.expense}
          categories={categories}
          busy={busy}
          today={today}
          onSave={(input) => run(editing.expense ? "travel-expense-update" : "travel-expense-create", input)}
          onDelete={
            editing.expense
              ? () => run("travel-expense-delete", { id: editing.expense?.id, expected: editing.expense } as DataRecord)
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
