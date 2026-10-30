import { useRef, useState, type SubmitEvent } from "react";
import type { DataRecord } from "../toolData";
import type { DiaryPageProps } from "./DiaryPage";
import { moveDay } from "./plannerData";

type DiaryPageTaskLineState = {
  expanded: boolean;
  moving: boolean;
  destination: string;
  failure: string;
  saving: boolean;
  toggleExpanded: () => void;
  toggleMoving: () => void;
  cancelMove: () => void;
  setDestination: (value: string) => void;
  submitMove: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
};

export function useDiaryPageTaskLine({
  item,
  date,
  busy,
  onMove,
}: {
  item: DataRecord;
  date: string;
  busy: boolean;
  onMove: DiaryPageProps["onMoveTask"];
}): DiaryPageTaskLineState {
  const [expanded, setExpanded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState(moveDay(date, 1));
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function submitMove(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending.current || busy || !destination || destination === date) return;
    pending.current = true;
    setSaving(true);
    setFailure("");
    try {
      if (await onMove(item, destination)) setMoving(false);
      else setFailure("옮기지 못했어요. 다시 시도해 주세요.");
    } catch {
      setFailure("옮기지 못했어요. 다시 시도해 주세요.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return {
    expanded,
    moving,
    destination,
    failure,
    saving,
    setDestination,
    submitMove,
    toggleExpanded: () => setExpanded((value) => !value),
    toggleMoving: () => setMoving((value) => !value),
    cancelMove: () => setMoving(false),
  };
}
