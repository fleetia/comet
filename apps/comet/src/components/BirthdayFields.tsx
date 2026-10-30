import type { JSX } from "react";
import { Select } from "@comet/ui";
import type { UserBirthday } from "../types";
import * as styles from "./birthdayFields.css";

export type BirthdayDraft = { month: string; day: string; year: string };

export function birthdayDraft(birthday: UserBirthday | null | undefined): BirthdayDraft {
  return {
    month: birthday ? String(birthday.month) : "",
    day: birthday ? String(birthday.day) : "",
    year: birthday?.year != null ? String(birthday.year) : "",
  };
}

export function birthdayValue(draft: BirthdayDraft): UserBirthday | null | undefined {
  if (!draft.month && !draft.day && !draft.year) return null;
  if (!draft.month || !draft.day) return undefined;
  const month = Number(draft.month);
  const day = Number(draft.day);
  const year = draft.year ? Number(draft.year) : null;
  const maxDay = new Date(year ?? 2000, month, 0).getDate();
  if (day > maxDay) return undefined;
  return { month, day, year };
}

export function BirthdayFields({
  value,
  onChange,
  disabled,
}: {
  value: BirthdayDraft;
  onChange: (value: BirthdayDraft) => void;
  disabled?: boolean;
}): JSX.Element {
  const currentYear = new Date().getFullYear();
  return (
    <div className={styles.fields} role="group" aria-label="생일 선택">
      <Select
        label="연도 (선택)"
        value={value.year}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, year: event.target.value })}
      >
        <option value="">선택 안 함</option>
        {Array.from({ length: currentYear - 1899 }, (_, index) => currentYear - index).map(
          (year) => (
            <option key={year} value={year}>
              {year}년
            </option>
          ),
        )}
      </Select>
      <Select
        label="월"
        value={value.month}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, month: event.target.value })}
      >
        <option value="">선택</option>
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
          <option key={month} value={month}>
            {month}월
          </option>
        ))}
      </Select>
      <Select
        label="일"
        value={value.day}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, day: event.target.value })}
      >
        <option value="">선택</option>
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>
            {day}일
          </option>
        ))}
      </Select>
    </div>
  );
}
