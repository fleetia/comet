import { useState, type ReactElement } from "react";
import { Button, Dialog, FormField, Select, TextInput, TripInfoRow } from "@comet/ui";
import { won } from "../Planner/diaryLedgerData";
import type { DataRecord } from "../toolData";
import { ME, shareOf } from "./travelMoney";
import type { Person, TripData } from "./travelTypes";
import * as s from "./travel.css";

export const PERSON_COLORS: [string, string][] = [
  ["blue", "파랑"],
  ["coral", "산호"],
  ["green", "초록"],
  ["violet", "보라"],
  ["yellow", "노랑"],
  ["pink", "분홍"],
  ["gray", "회색"],
];

function shareTotal(trip: TripData, person: string): number {
  return trip.expenses
    .filter((expense) => expense.paid)
    .reduce((sum, expense) => sum + shareOf(expense, person), 0);
}

export function TravelPeople({
  trip,
  busy,
  onSave,
  onDelete,
  onSettle,
}: {
  trip: TripData;
  busy: boolean;
  onSave: (input: DataRecord, person?: Person) => Promise<boolean>;
  onDelete: (person: Person) => Promise<boolean>;
  onSettle: () => void;
}): ReactElement {
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>함께 가는 {trip.people.length + 1}명</h2>
        <p className={s.caption}>여행의 비용을 나눌 사람들과 각자의 몫이에요. 이 컴퓨터에만 적어 둬요.</p>
      </div>
      <section className={s.list} aria-label="함께 가는 사람">
        <TripInfoRow
          className={s.row}
          title="나"
          detail="예약과 비용을 정리하고 있어요."
          value={`나눌 몫 ${won(shareTotal(trip, ME))}`}
        />
        {trip.people.map((person) => (
          <TripInfoRow
            key={person.id}
            className={s.row}
            title={
              <span className={s.inline}>
                <span className={s.dot} data-color={person.color} aria-hidden />
                {person.name}
              </span>
            }
            detail="함께 가는 사람"
            value={`나눌 몫 ${won(shareTotal(trip, person.id))}`}
            disabled={busy}
            onClick={() => setEditing(person)}
          />
        ))}
      </section>
      <div className={s.spreadActions}>
        <Button disabled={busy || trip.people.length >= 30} onClick={() => setEditing("new")}>
          사람 더하기
        </Button>
        <Button variant="ghost" onClick={onSettle}>
          정산 보기
        </Button>
      </div>
      {editing && (
        <PersonEditor
          person={editing === "new" ? undefined : editing}
          index={trip.people.length}
          busy={busy}
          onSave={(input) => onSave(input, editing === "new" ? undefined : editing)}
          onDelete={editing === "new" ? undefined : () => onDelete(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function PersonEditor({
  person,
  index,
  busy,
  onSave,
  onDelete,
  onClose,
}: {
  person?: Person;
  index: number;
  busy: boolean;
  onSave: (input: DataRecord) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState(person?.name ?? "");
  const [color, setColor] = useState(person?.color ?? PERSON_COLORS[index % PERSON_COLORS.length][0]);
  const caption = person ? "사람 고치기" : "함께 가는 사람 더하기";
  return (
    <Dialog
      isOpen
      size="small"
      title={caption}
      closeLabel={`${caption} 닫기`}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <form
        className={s.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void onSave({ name, color }).then((done) => done && onClose());
        }}
      >
        <FormField label="이름" required>
          <TextInput value={name} maxLength={30} placeholder="엄마" disabled={busy} onChange={(event) => setName(event.target.value)} />
        </FormField>
        <FormField label="색">
          <Select value={color} disabled={busy} onChange={(event) => setColor(event.target.value)}>
            {PERSON_COLORS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        {!person && <p className={s.caption}>똑같이 나누던 비용에는 이 사람도 함께 들어가요.</p>}
        <div className={s.formActions}>
          {onDelete && (
            <Button
              variant="danger"
              className={s.deleteAction}
              disabled={busy}
              onClick={() => void onDelete().then((done) => done && onClose())}
            >
              빼기
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={busy}>
            저장
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
