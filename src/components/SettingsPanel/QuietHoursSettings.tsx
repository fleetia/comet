import { Checkbox, FormField, TextField } from "@fleetia/lagrange";
import type { QuietHours } from "../../types";
import * as s from "../../styles.css";
import * as d from "../../desktop.css";

export function quietHoursError(settings: QuietHours): string | null {
  if (!settings.enabled) return null;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(settings.start) || !clock.test(settings.end) || settings.start === settings.end) {
    return "시작과 종료 시각을 다르게 정해 주세요.";
  }
  if (
    !settings.weekdays.length ||
    settings.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    return "요일을 하나 이상 골라 주세요.";
  }
  return null;
}

export function QuietHoursSettings({
  value,
  onChange,
}: {
  value: QuietHours;
  onChange: (value: QuietHours) => void;
}) {
  const error = quietHoursError(value);
  return (
    <section aria-label="예약된 조용한 시간">
      <h2 className={s.sectionTitle}>예약된 조용한 시간</h2>
      <Checkbox
        className={s.row}
        checked={value.enabled}
        onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
      >
        정해진 시간에 자동 잡담 쉬기
      </Checkbox>
      <p className={s.quiet}>
        기기 지역 시각 ({Intl.DateTimeFormat().resolvedOptions().timeZone}). 기기의 시간대가 바뀌면
        따라가요.
      </p>
      <fieldset className={d.fieldset} disabled={!value.enabled}>
        <legend>조용한 시간과 시작 요일</legend>
        <div className={s.row}>
          <FormField className={s.field} label="조용한 시간 시작">
            <TextField
              type="time"
              value={value.start}
              onChange={(event) => onChange({ ...value, start: event.target.value })}
            />
          </FormField>
          <FormField className={s.field} label="조용한 시간 종료">
            <TextField
              type="time"
              value={value.end}
              onChange={(event) => onChange({ ...value, end: event.target.value })}
            />
          </FormField>
        </div>
        <div className={s.row}>
          {["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"].map(
            (label, day) => (
              <Checkbox
                key={day}
                checked={value.weekdays.includes(day)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    weekdays: event.target.checked
                      ? [...value.weekdays, day].sort((a, b) => a - b)
                      : value.weekdays.filter((value) => value !== day),
                  })
                }
              >
                {label}
              </Checkbox>
            ),
          )}
        </div>
      </fieldset>
      <p className={s.quiet}>
        자정을 넘으면 시작하는 요일을 기준으로 해요. 월요일 22:00~08:00은 화요일 아침까지 쉬어요.
        자동 잡담·이야기·장난·AI 위젯 자동 제작을 쉬고, 끝나면 새 이야기 간격을 기다려요. 직접
        대화와 타이머 종료·일정 알림·켜 둔 무드메이커, 별도 OS 알림 설정은 유지해요. 수동 일시정지와
        1시간 조용히는 별도로 적용돼요.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
