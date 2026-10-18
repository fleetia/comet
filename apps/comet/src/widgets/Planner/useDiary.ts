import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { localDay, type DataRecord } from "../toolData";
import type { DiaryState } from "./diaryTypes";
import { addDays } from "../Travel/travelData";

function preview(): DiaryState {
  const date = localDay();
  return {
    revision: 0,
    pages: [
      {
        id: "preview-day",
        title: "",
        date,
        entries: [
          {
            id: "walk-note",
            kind: "note",
            text: "돌아오는 길에 한 정거장 먼저 내려 걸었다.\n바람이 좋아서 조금 더 걷고 싶었다.",
          },
          { id: "book-envelope", kind: "envelope", text: "책 모임 준비", refId: "book-prep" },
        ],
      },
      {
        id: "books-page",
        title: "읽은 책",
        date: null,
        entries: [{ id: "books-note", kind: "note", text: "마음에 남은 문장을 이곳에 모아두기." }],
      },
    ],
    notes: [
      {
        id: "book-note",
        title: "책 모임 아이디어",
        body: "좋았던 문장 하나씩 골라오기.\n질문은 정답이 없는 것으로.",
        pinned: true,
        envelopeId: "book-prep",
      },
    ],
    moves: [],
    timeRecords: [
      { id: "preview-work", date, startMinute: 540, endMinute: 720, categoryId: "work", title: "오전 작업" },
      { id: "preview-walk", date, startMinute: 750, endMinute: 780, categoryId: "exercise", title: "산책" },
    ],
    habits: [
      { id: "preview-habit", title: "하루 20분 읽기", description: "잠들기 전 책 한 권", color: "record", weekdays: [0, 1, 2, 3, 4, 5, 6], weeklyGoal: 7, mode: "check", target: 1, startDate: date, reminderTime: null, archived: false },
    ],
    habitChecks: [],
    ledgerEntries: [
      { id: "preview-lunch", date, kind: "expense", amount: 12000, category: "food", title: "점심", memo: "" },
    ],
    ledgerRecurring: [],
    travels: [
      {
        id: "preview-trip",
        title: "제주 가족 여행",
        destination: "제주",
        startDate: addDays(date, 3),
        endDate: addDays(date, 4),
        timeZone: "Asia/Seoul",
        currency: "KRW",
        budget: 2000000,
        envelopeId: "book-prep",
        finished: false,
      },
    ],
    travelPlans: [
      { id: "preview-flight", travelId: "preview-trip", kind: "move", date: addDays(date, 3), time: "09:10", title: "김포 → 제주", place: "", memo: "", arriveDate: addDays(date, 3), arriveTime: "10:20" },
      { id: "preview-car", travelId: "preview-trip", kind: "plan", date: addDays(date, 3), time: "10:50", title: "렌터카 받기", place: "제주공항 인근", memo: "현장 결제" },
      { id: "preview-stay", travelId: "preview-trip", kind: "plan", date: addDays(date, 3), time: "15:00", title: "애월 숙소 체크인", place: "애월", memo: "체크아웃 다음 날 오전 11:00" },
    ],
  };
}

export function useDiary(): {
  state: DiaryState | null;
  busy: boolean;
  error: string | null;
  reload: () => void;
  mutate: (action: string, input?: DataRecord) => Promise<DiaryState | null>;
} {
  const [state, setState] = useState<DiaryState | null>(() => (isDesktop() ? null : preview()));
  const latest = useRef(state);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  function receive(value: DiaryState): void {
    if (!alive.current || (latest.current && value.revision < latest.current.revision)) return;
    latest.current = value;
    setState(value);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<DiaryState>("diary-updated", (event) => {
      if (active) receive(event.payload);
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const value = await command<DiaryState>("get_diary");
        if (active) {
          receive(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh]);
  function mutate(action: string, input: DataRecord = {}): Promise<DiaryState | null> {
    if (!isDesktop()) {
      setError("예시 미리보기예요. 기록은 데스크톱 앱에서 저장할 수 있어요.");
      return Promise.resolve(null);
    }
    setPending((count) => count + 1);
    const operation = tail.current
      .then(async (): Promise<DiaryState | null> => {
        if (!alive.current || !latest.current) return null;
        try {
          setError(null);
          const result = await command<DiaryState>("update_diary", {
            expectedRevision: latest.current.revision,
            action,
            input,
          });
          receive(result);
          return result;
        } catch (cause: unknown) {
          if (alive.current) {
            setError(errorText(cause));
            try {
              receive(await command<DiaryState>("get_diary"));
            } catch {
              /* Keep the last readable state and the unsaved draft. */
            }
          }
          return null;
        }
      })
      .finally(() => {
        if (alive.current) setPending((count) => count - 1);
      });
    tail.current = operation;
    return operation;
  }
  return {
    state,
    busy: pending > 0,
    error,
    reload: () => setRefresh((value) => value + 1),
    mutate,
  };
}
