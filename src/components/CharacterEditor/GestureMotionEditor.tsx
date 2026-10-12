import type { JSX } from "react";
import { Button, FormField, Select, TextField } from "@fleetia/lagrange";
import type { CharacterBodyRegion, CharacterDefinition, CharacterGestureMotion } from "../../types";
import { MotionSelect } from "../MotionSelect/MotionSelect";
import { SUSTAINED_GESTURES } from "../AnimationEditor/helpers";
import * as common from "../characters.css";

const GESTURES = [
  ["poke", "찌르기"],
  ["stroke", "쓰다듬기"],
  ["cheek-grab", "볼 잡기"],
  ["pickup", "집기"],
  ["snack", "간식"],
  ["wake", "깨우기"],
  ["drink", "음료"],
  ["gift", "선물"],
  ["idle-yawn", "하품"],
  ["idle-stretch", "기지개"],
  ["walk", "산책"],
  ["fast-walk", "빠른 걸음"],
  ["crawl", "기기"],
  ["climb", "가장자리 타기"],
  ["short-fall", "짧은 낙하"],
  ["peek", "빼꼼"],
] as const;

export function GestureMotionEditor({
  definition,
  onChange,
}: {
  definition: CharacterDefinition;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const regions = definition.bodyRegions ?? [];
  const motions = definition.gestureMotions ?? [];
  function updateRegion(index: number, patch: Partial<CharacterBodyRegion>): void {
    onChange({
      ...definition,
      bodyRegions: regions.map((region, at) => (at === index ? { ...region, ...patch } : region)),
    });
  }
  function updateMotion(index: number, patch: Partial<CharacterGestureMotion>): void {
    onChange({
      ...definition,
      gestureMotions: motions.map((motion, at) =>
        at === index ? { ...motion, ...patch } : motion,
      ),
    });
  }
  return (
    <details>
      <summary className={common.disclosureSummary}>부위와 교감 동작</summary>
      <p className={common.small}>
        영역과 잡는 점은 본체 너비·높이의 백분율로 지정해요. 겹치는 부위는 작은 영역을 먼저
        사용해요.
      </p>
      {regions.map((region, index) => (
        <fieldset key={region.id}>
          <legend>{region.name || "새 부위"}</legend>
          <FormField label="부위 이름">
            <TextField
              aria-label={`부위 ${index + 1} 이름`}
              value={region.name}
              onChange={(event) => updateRegion(index, { name: event.target.value })}
            />
          </FormField>
          {(["x", "y", "width", "height"] as const).map((key) => (
            <FormField
              key={key}
              label={{ x: "왼쪽", y: "위쪽", width: "너비", height: "높이" }[key] + " (%)"}
            >
              <TextField
                type="number"
                min={0}
                max={100}
                step={1}
                aria-label={`${region.name} ${key} (%)`}
                value={Math.round(region[key] * 10000) / 100}
                onChange={(event) =>
                  updateRegion(index, { [key]: Number(event.target.value) / 100 })
                }
              />
            </FormField>
          ))}
          {(["x", "y"] as const).map((key) => (
            <FormField key={key} label={`잡는 점 ${key} (%)`}>
              <TextField
                type="number"
                min={0}
                max={100}
                aria-label={`${region.name} 잡는 점 ${key}`}
                value={
                  Math.round(
                    (region.grabPoint?.[key] ??
                      region[key] + region[key === "x" ? "width" : "height"] / 2) * 10000,
                  ) / 100
                }
                onChange={(event) =>
                  updateRegion(index, {
                    grabPoint: {
                      x: region.grabPoint?.x ?? region.x + region.width / 2,
                      y: region.grabPoint?.y ?? region.y + region.height / 2,
                      [key]: Number(event.target.value) / 100,
                    },
                  })
                }
              />
            </FormField>
          ))}
          <Button
            type="button"
            variant="quiet"
            disabled={motions.some((motion) => motion.regionId === region.id)}
            onClick={() =>
              onChange({ ...definition, bodyRegions: regions.filter((_, at) => at !== index) })
            }
          >
            부위 삭제
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={regions.length >= 16}
        onClick={() =>
          onChange({
            ...definition,
            bodyRegions: [
              ...regions,
              {
                id: crypto.randomUUID(),
                name: "새 부위",
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                grabPoint: { x: 0.5, y: 0.5 },
              },
            ],
          })
        }
      >
        부위 추가
      </Button>
      {motions.map((motion, index) => {
        const sustained = SUSTAINED_GESTURES.includes(motion.gesture);
        return (
          <fieldset key={motion.id}>
            <legend>교감 동작 {index + 1}</legend>
            <Select
              aria-label={`교감 ${index + 1} 행동`}
              value={motion.gesture}
              onChange={(event) => {
                const gesture = event.target.value as CharacterGestureMotion["gesture"];
                updateMotion(index, {
                  gesture,
                  ...(SUSTAINED_GESTURES.includes(gesture) ? {} : { hold: undefined }),
                  ...(gesture === "pickup" ? {} : { movingHold: undefined }),
                });
              }}
            >
              {GESTURES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`교감 ${index + 1} 부위`}
              value={motion.regionId ?? ""}
              onChange={(event) =>
                updateMotion(index, { regionId: event.target.value || undefined })
              }
            >
              <option value="">모든 부위</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`교감 ${index + 1} 표정`}
              value={motion.expression ?? ""}
              onChange={(event) =>
                updateMotion(index, { expression: event.target.value || undefined })
              }
            >
              <option value="">현재 표정 유지</option>
              {Object.keys(definition.expressions).map((expression) => (
                <option key={expression}>{expression}</option>
              ))}
            </Select>
            {(
              [
                "start",
                ...(sustained ? ["hold"] : []),
                ...(motion.gesture === "pickup" ? ["movingHold"] : []),
                "end",
              ] as ("start" | "hold" | "movingHold" | "end")[]
            ).map((phase) => (
              <MotionSelect
                key={phase}
                label={`교감 ${index + 1} · ${{ start: "시작", hold: "유지", movingHold: "움직이는 동안", end: "종료" }[phase]}`}
                value={motion[phase]}
                clips={definition.animation?.clips ?? []}
                once={phase === "start" || phase === "end"}
                continuous={phase === "hold" || phase === "movingHold"}
                onChange={(value) => updateMotion(index, { [phase]: value })}
              />
            ))}
            <Button
              type="button"
              variant="quiet"
              onClick={() =>
                onChange({ ...definition, gestureMotions: motions.filter((_, at) => at !== index) })
              }
            >
              교감 동작 삭제
            </Button>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        disabled={motions.length >= 32}
        onClick={() =>
          onChange({
            ...definition,
            gestureMotions: [
              ...motions,
              { id: crypto.randomUUID(), gesture: "poke", start: { mode: "static" } },
            ],
          })
        }
      >
        교감 동작 추가
      </Button>
      <p className={common.small}>
        한 번의 교감은 부위별 동작, 모든 부위 동작 순서로 한 후보를 선택해요. 유지 단계는 놓을
        때까지 반복해요.
      </p>
    </details>
  );
}
