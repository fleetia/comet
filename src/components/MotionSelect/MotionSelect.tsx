import type { JSX } from "react";
import { Checkbox, FormField, Select, TextField } from "@fleetia/lagrange";
import {
  CHARACTER_SLOTS,
  type AnimationClip,
  type InstalledCharacter,
  type MotionOverride,
} from "../../types";
import * as s from "./motionSelect.css";

export function motionOwner(
  persona: string,
  owners: (InstalledCharacter | undefined)[],
): InstalledCharacter | undefined {
  return (
    owners.find((owner) => owner?.id === persona) ??
    owners[CHARACTER_SLOTS.findIndex((slot) => slot === persona)]
  );
}

export function motionError(
  motion: MotionOverride | undefined,
  clips: AnimationClip[],
  once = false,
): string | null {
  if (motion?.mode !== "clip") return null;
  if (!clips.some((clip) => clip.id === motion.clipId))
    return "연결한 동작이 없어요. 다른 동작이나 기본 연결을 선택해 주세요.";
  if (!Number.isInteger(motion.intervalMs) || motion.intervalMs < 0 || motion.intervalMs > 60_000)
    return "동작의 반복 간격은 0~60초로 입력해 주세요.";
  if (once && (motion.repeat || motion.intervalMs !== 0))
    return "이 사건의 동작은 반복 없이 한 번만 재생해요.";
  return null;
}

export function MotionSelect({
  label,
  value,
  clips,
  once = false,
  onChange,
}: {
  label: string;
  value?: MotionOverride;
  clips: AnimationClip[];
  once?: boolean;
  onChange: (motion: MotionOverride | undefined) => void;
}): JSX.Element {
  const selected = value?.mode === "clip" ? `clip:${value.clipId}` : (value?.mode ?? "inherit");
  const error = motionError(value, clips, once);
  return (
    <div className={s.container}>
      <FormField label="동작">
        <Select
          aria-label={`${label} 동작`}
          value={selected}
          onChange={(event) => {
            const id = event.target.value;
            if (id === "inherit") onChange(undefined);
            else if (id === "static") onChange({ mode: "static" });
            else onChange({ mode: "clip", clipId: id.slice(5), repeat: !once, intervalMs: 0 });
          }}
        >
          <option value="inherit">기본 연결 사용</option>
          <option value="static">동작 없음 · 정적 표정</option>
          {value?.mode === "clip" && !clips.some((clip) => clip.id === value.clipId) && (
            <option value={`clip:${value.clipId}`}>없는 동작 · 다시 선택</option>
          )}
          {clips.map((clip) => (
            <option key={clip.id} value={`clip:${clip.id}`}>
              {clip.name || "이름 없는 동작"}
            </option>
          ))}
        </Select>
      </FormField>
      {value?.mode === "clip" &&
        (once ? (
          <span className={s.hint}>한 번 재생</span>
        ) : (
          <>
            <Checkbox
              checked={value.repeat}
              onChange={(event) => onChange({ ...value, repeat: event.target.checked })}
            >
              {label} 반복
            </Checkbox>
            <FormField label="반복 간격(초)">
              <TextField
                className={s.number}
                aria-label={`${label} 동작 반복 간격(초)`}
                type="number"
                min={0}
                max={60}
                step={0.1}
                disabled={!value.repeat}
                value={value.intervalMs / 1000}
                onChange={(event) =>
                  onChange({ ...value, intervalMs: Math.round(Number(event.target.value) * 1000) })
                }
              />
            </FormField>
          </>
        ))}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
