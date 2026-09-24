import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Button, Checkbox, FormField, Select, TextField } from "@fleetia/lagrange";
import type {
  AnimationAsset,
  AnimationBinding,
  AnimationClip,
  AnimationFrame,
  CharacterAnimation,
  InstalledCharacter,
} from "../../types";
import { useAnimationFrames } from "../../hooks/useAnimationFrames";
import { useAnimationPlayer } from "../../hooks/useAnimationPlayer";
import { AnimationFrameView } from "../AnimationFrameView/AnimationFrameView";
import { animationAssetUrl } from "../characterAnimation";
import { DEFAULT_EXPRESSION, spriteSource } from "../characterIdentity";
import {
  animationError,
  appendFrames,
  defaultBinding,
  EMPTY_ANIMATION,
  MAX_ANIMATION_CLIPS,
  MAX_ANIMATION_FRAMES,
  removeAnimationClip,
  sequenceFrames,
  sheetFrames,
} from "./helpers";
import * as common from "../characters.css";
import * as s from "./animationEditor.css";

type Situation = "idle" | "speaking" | "click";
type Props = {
  animation?: CharacterAnimation | null;
  character?: InstalledCharacter;
  expressions: string[];
  assets: AnimationAsset[];
  size: number;
  visible: boolean;
  onChange: (animation: CharacterAnimation, assets?: AnimationAsset[]) => void;
  onChooseAssets?: () => Promise<AnimationAsset[]>;
};

function BindingEditor({
  label,
  situation,
  value,
  clips,
  inherit = false,
  onChange,
}: {
  label: string;
  situation: Situation;
  value: AnimationBinding | null | undefined;
  clips: AnimationClip[];
  inherit?: boolean;
  onChange: (value: AnimationBinding | null | undefined) => void;
}): JSX.Element {
  return (
    <div className={s.binding}>
      <span>{label}</span>
      <Select
        aria-label={`${label} 동작`}
        value={value?.clipId ?? (inherit && value === undefined ? "$inherit" : "$none")}
        onChange={(event) => {
          const id = event.target.value;
          if (id === "$inherit") {
            onChange(undefined);
          } else if (id === "$none") {
            onChange(null);
          } else {
            onChange(defaultBinding(id, situation));
          }
        }}
      >
        {inherit && <option value="$inherit">공통 설정 사용</option>}
        <option value="$none">
          {!inherit && situation === "speaking" ? "기본 동작 사용" : "동작 없음"}
        </option>
        {clips.map((clip) => (
          <option key={clip.id} value={clip.id}>
            {clip.name || "이름 없는 동작"}
          </option>
        ))}
      </Select>
      {value && situation === "click" && <span className={common.small}>한 번 재생</span>}
      {value && situation !== "click" && (
        <div className={s.playback}>
          <Checkbox
            checked={value.repeat}
            onChange={(event) => onChange({ ...value, repeat: event.target.checked })}
          >
            {label} 반복
          </Checkbox>
          <FormField label="반복 간격(초)">
            <TextField
              className={s.number}
              aria-label={`${label} 반복 간격(초)`}
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
          {!value.repeat && <span className={common.small}>한 번 재생</span>}
        </div>
      )}
    </div>
  );
}

export function AnimationEditor({
  animation: saved,
  character,
  expressions,
  assets,
  size,
  visible,
  onChange,
  onChooseAssets,
}: Props): JSX.Element {
  const animation = saved ?? EMPTY_ANIMATION;
  const [selectedId, setSelectedId] = useState(animation.clips[0]?.id ?? "");
  const clip = animation.clips.find((item) => item.id === selectedId) ?? animation.clips[0];
  const [playing, setPlaying] = useState(false);
  const [playVersion, setPlayVersion] = useState(0);
  const [manualIndex, setManualIndex] = useState(0);
  const [previewRepeat, setPreviewRepeat] = useState(true);
  const [previewInterval, setPreviewInterval] = useState(0);
  const [cellWidth, setCellWidth] = useState(64);
  const [cellHeight, setCellHeight] = useState(64);
  const [cellCount, setCellCount] = useState(1);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ animation, clip, onChange });
  latest.current = { animation, clip, onChange };
  const chooseVersion = useRef(0);
  useEffect(
    () => () => {
      chooseVersion.current += 1;
    },
    [],
  );
  useEffect(() => {
    setPlaying(false);
    setManualIndex(0);
  }, [clip?.id, visible]);

  const sources = useMemo(() => {
    const referenced = new Set(clip?.frames.map((frame) => frame.assetId));
    const result = character
      ? Object.fromEntries(
          Object.keys(character.animationAssets ?? {})
            .filter((id) => referenced.has(id))
            .map((id) => [id, animationAssetUrl(character.id, id)]),
        )
      : {};
    for (const asset of assets) {
      if (referenced.has(asset.assetId)) {
        result[asset.assetId] = `data:${asset.mime};base64,${asset.data}`;
      }
    }
    return result;
  }, [character?.id, character?.animationAssets, assets, clip?.frames]);
  const metadata = useMemo(
    () => ({
      ...character?.animationAssets,
      ...Object.fromEntries(assets.map((asset) => [asset.assetId, asset])),
    }),
    [character?.animationAssets, assets],
  );
  const previewSize = Math.min(128, Math.max(32, size));
  const { frames, ready, error: previewError } = useAnimationFrames(clip, sources, previewSize);
  const player = useAnimationPlayer({
    clip,
    binding: { repeat: previewRepeat, intervalMs: previewInterval },
    runKey: `${clip?.id ?? ""}:${playVersion}`,
    enabled:
      playing &&
      visible &&
      Number.isInteger(clip?.fps) &&
      (clip?.fps ?? 0) >= 1 &&
      (clip?.fps ?? 0) <= 30,
    ready,
  });
  const shownIndex = playing
    ? player.frameIndex
    : Math.min(manualIndex, (clip?.frames.length ?? 1) - 1);
  const validationError = animationError(saved, metadata);
  const fallbackImage = spriteSource(character, DEFAULT_EXPRESSION);
  useEffect(() => {
    if (player.finished) {
      setPlaying(false);
      setManualIndex(Math.max(0, (clip?.frames.length ?? 1) - 1));
    }
  }, [player.finished, clip?.frames.length]);

  function changeClip(update: Partial<AnimationClip>): void {
    if (clip) {
      onChange({
        ...animation,
        clips: animation.clips.map((item) => (item.id === clip.id ? { ...item, ...update } : item)),
      });
    }
  }

  function moveFrame(index: number, offset: number): void {
    if (!clip || index + offset < 0 || index + offset >= clip.frames.length) {
      return;
    }
    const next = [...clip.frames];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    changeClip({ frames: next });
    setPlaying(false);
    setManualIndex(index + offset);
  }

  async function choose(kind: "sequence" | "sheet"): Promise<void> {
    if (!onChooseAssets || !clip || choosing) {
      return;
    }
    const request = ++chooseVersion.current;
    const clipId = clip.id;
    setChoosing(true);
    setError(null);
    try {
      const selected = await onChooseAssets();
      if (request !== chooseVersion.current || selected.length === 0) {
        return;
      }
      const current = latest.current;
      const target = current.animation.clips.find((item) => item.id === clipId);
      if (!target) {
        return;
      }
      if (kind === "sheet" && selected.length !== 1) {
        throw new Error(
          "스프라이트 시트는 정지 PNG 한 장만 선택해 주세요. APNG는 프레임 추가로 가져오세요.",
        );
      }
      const added: AnimationFrame[] =
        kind === "sheet"
          ? sheetFrames(selected[0], cellWidth, cellHeight, cellCount)
          : sequenceFrames(selected);
      const nextClip = appendFrames(target, added);
      current.onChange(
        {
          ...current.animation,
          clips: current.animation.clips.map((item) => (item.id === clipId ? nextClip : item)),
        },
        selected,
      );
      setPlaying(false);
      setManualIndex(target.frames.length);
    } catch (cause) {
      if (request === chooseVersion.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (request === chooseVersion.current) {
        setChoosing(false);
      }
    }
  }

  function setOverride(
    expression: string,
    situation: "idle" | "speaking",
    binding: AnimationBinding | null | undefined,
  ): void {
    const override = { ...animation.overrides[expression] };
    if (binding === undefined) {
      delete override[situation];
    } else {
      override[situation] = binding;
    }
    const overrides = { ...animation.overrides, [expression]: override };
    if (Object.keys(override).length === 0) {
      delete overrides[expression];
    }
    onChange({ ...animation, overrides });
  }

  return (
    <section className={common.section} aria-label="애니메이션">
      <h3 className={common.subheading}>동작</h3>
      <p className={common.small}>
        PNG·APNG 프레임이나 스프라이트 시트로 동작을 만들고 상황에 연결해요. 캐릭터 저장으로 함께
        반영해요.
      </p>
      <div className={s.editor}>
        <div className={s.controls}>
          <Select
            aria-label="편집할 동작"
            value={clip?.id ?? ""}
            disabled={animation.clips.length === 0}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setError(null);
            }}
          >
            {animation.clips.length === 0 && <option value="">등록한 동작 없음</option>}
            {animation.clips.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || "이름 없는 동작"}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="compact"
            type="button"
            disabled={animation.clips.length >= MAX_ANIMATION_CLIPS}
            onClick={() => {
              const id = crypto.randomUUID();
              onChange({
                ...animation,
                clips: [
                  ...animation.clips,
                  { id, name: `새 동작 ${animation.clips.length + 1}`, fps: 8, frames: [] },
                ],
              });
              setSelectedId(id);
              setError(null);
            }}
          >
            동작 추가
          </Button>
          {clip && (
            <Button
              variant="quiet"
              size="compact"
              type="button"
              onClick={() => onChange(removeAnimationClip(animation, clip.id))}
            >
              동작 삭제
            </Button>
          )}
        </div>
        {clip && (
          <>
            <div className={s.clipFields}>
              <FormField label="동작 이름">
                <TextField
                  aria-label="동작 이름"
                  maxLength={80}
                  value={clip.name}
                  onChange={(event) => changeClip({ name: event.target.value })}
                />
              </FormField>
              <FormField label="초당 프레임">
                <TextField
                  aria-label="동작 속도(fps)"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={clip.fps}
                  onChange={(event) => changeClip({ fps: Number(event.target.value) })}
                />
              </FormField>
            </div>
            <div className={s.preview}>
              {shownIndex === null ? (
                <span className={s.fallback} style={{ width: previewSize, height: previewSize }}>
                  {fallbackImage ? (
                    <img className={common.spriteImage} src={fallbackImage} alt="기본 표정" />
                  ) : (
                    (character?.definition.expressions[DEFAULT_EXPRESSION] ?? DEFAULT_EXPRESSION)
                  )}
                </span>
              ) : (
                <AnimationFrameView
                  frames={frames}
                  index={shownIndex}
                  size={previewSize}
                  label="동작 미리보기"
                />
              )}
              <span className={common.small}>
                {clip.frames.length === 0
                  ? "프레임을 추가해 주세요."
                  : `${shownIndex === null ? "쉬는 중" : `${shownIndex + 1} / ${clip.frames.length} 프레임`}`}
              </span>
            </div>
            <div className={s.controls}>
              <Button
                variant="secondary"
                size="compact"
                type="button"
                disabled={!ready}
                onClick={() => {
                  setPlaying(!playing);
                  if (!playing) {
                    setPlayVersion((value) => value + 1);
                  } else {
                    setManualIndex(player.frameIndex ?? 0);
                  }
                }}
              >
                {playing ? "미리보기 정지" : "미리보기 재생"}
              </Button>
              <Button
                variant="quiet"
                size="compact"
                type="button"
                disabled={clip.frames.length === 0}
                onClick={() => {
                  setPlaying(false);
                  setManualIndex(((shownIndex ?? 0) - 1 + clip.frames.length) % clip.frames.length);
                }}
              >
                이전 프레임
              </Button>
              <Button
                variant="quiet"
                size="compact"
                type="button"
                disabled={clip.frames.length === 0}
                onClick={() => {
                  setPlaying(false);
                  setManualIndex(((shownIndex ?? -1) + 1) % clip.frames.length);
                }}
              >
                다음 프레임
              </Button>
              <Checkbox
                checked={previewRepeat}
                onChange={(event) => setPreviewRepeat(event.target.checked)}
              >
                미리보기 반복
              </Checkbox>
              <FormField label="쉬는 간격(초)">
                <TextField
                  className={s.number}
                  aria-label="미리보기 반복 간격(초)"
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  disabled={!previewRepeat}
                  value={previewInterval / 1000}
                  onChange={(event) =>
                    setPreviewInterval(
                      Math.min(60_000, Math.max(0, Math.round(Number(event.target.value) * 1000))),
                    )
                  }
                />
              </FormField>
            </div>
            {previewError && (
              <p className={common.small} role="status">
                미리보기를 불러오지 못했어요. {previewError}
              </p>
            )}
            <div className={s.frames} aria-label="동작 프레임">
              {clip.frames.map((frame, index) => (
                <div className={s.frame} key={index} data-selected={shownIndex === index}>
                  <Button
                    variant="quiet"
                    size="compact"
                    type="button"
                    aria-label={`${index + 1}번 프레임 선택`}
                    onClick={() => {
                      setPlaying(false);
                      setManualIndex(index);
                    }}
                  >
                    <svg
                      width={48}
                      height={48}
                      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
                      aria-hidden="true"
                    >
                      <image
                        href={sources[frame.assetId] || undefined}
                        width={metadata[frame.assetId]?.width}
                        height={metadata[frame.assetId]?.height}
                      />
                    </svg>
                    {index + 1}
                  </Button>
                  <div className={s.frameActions}>
                    <Button
                      variant="quiet"
                      size="compact"
                      type="button"
                      aria-label={`${index + 1}번 프레임 앞으로`}
                      disabled={index === 0}
                      onClick={() => moveFrame(index, -1)}
                    >
                      ←
                    </Button>
                    <Button
                      variant="quiet"
                      size="compact"
                      type="button"
                      aria-label={`${index + 1}번 프레임 뒤로`}
                      disabled={index === clip.frames.length - 1}
                      onClick={() => moveFrame(index, 1)}
                    >
                      →
                    </Button>
                    <Button
                      variant="quiet"
                      size="compact"
                      type="button"
                      aria-label={`${index + 1}번 프레임 삭제`}
                      onClick={() =>
                        changeClip({ frames: clip.frames.filter((_, item) => item !== index) })
                      }
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className={s.controls}>
              <Button
                variant="secondary"
                size="compact"
                type="button"
                disabled={!onChooseAssets || choosing || clip.frames.length >= MAX_ANIMATION_FRAMES}
                onClick={() => void choose("sequence")}
              >
                {choosing ? "이미지 선택 중…" : "PNG/APNG 프레임 추가"}
              </Button>
              <span className={common.small}>같은 크기의 PNG·APNG · 최대 64프레임</span>
            </div>
            <div className={s.sheet}>
              <FormField label="칸 너비(px)">
                <TextField
                  className={s.number}
                  aria-label="시트 칸 너비(px)"
                  type="number"
                  min={1}
                  max={4096}
                  step={1}
                  value={cellWidth}
                  onChange={(event) => setCellWidth(Number(event.target.value))}
                />
              </FormField>
              <FormField label="칸 높이(px)">
                <TextField
                  className={s.number}
                  aria-label="시트 칸 높이(px)"
                  type="number"
                  min={1}
                  max={4096}
                  step={1}
                  value={cellHeight}
                  onChange={(event) => setCellHeight(Number(event.target.value))}
                />
              </FormField>
              <FormField label="프레임 수">
                <TextField
                  className={s.number}
                  aria-label="시트 프레임 수"
                  type="number"
                  min={1}
                  max={64}
                  step={1}
                  value={cellCount}
                  onChange={(event) => setCellCount(Number(event.target.value))}
                />
              </FormField>
              <Button
                variant="secondary"
                size="compact"
                type="button"
                disabled={!onChooseAssets || choosing || clip.frames.length >= MAX_ANIMATION_FRAMES}
                onClick={() => void choose("sheet")}
              >
                스프라이트 시트 추가
              </Button>
            </div>
            <p className={common.small}>
              시트 한 장을 왼쪽 위부터 행 순서로 나눠요. PNG·APNG당 2 MiB·4096×4096 이하. APNG는
              프레임 추가에서 가져오며 원래 간격 대신 지정한 동작 속도로 재생해요.
            </p>
          </>
        )}
        {(error || validationError) && (
          <p className={common.small} role="alert">
            {error || validationError}
          </p>
        )}
        <div>
          <h4 className={common.subheading}>상황 연결</h4>
          {(
            [
              ["idle", "평소"],
              ["speaking", "말하는 동안"],
              ["click", "클릭했을 때"],
            ] as const
          ).map(([situation, label]) => (
            <BindingEditor
              key={situation}
              label={label}
              situation={situation}
              value={animation.bindings[situation]}
              clips={animation.clips}
              onChange={(value) =>
                onChange({ ...animation, bindings: { ...animation.bindings, [situation]: value } })
              }
            />
          ))}
          <p className={common.small}>
            클릭 반응이 먼저 재생돼요. 동작이 끝나거나 쉬는 동안에는 현재 표정으로 돌아와요.
          </p>
          <details className={s.expression}>
            <summary>표정마다 다르게 연결</summary>
            {expressions.map((expression) => (
              <div key={expression}>
                <BindingEditor
                  label={`${expression} · 평소`}
                  situation="idle"
                  value={animation.overrides[expression]?.idle}
                  clips={animation.clips}
                  inherit
                  onChange={(value) => setOverride(expression, "idle", value)}
                />
                <BindingEditor
                  label={`${expression} · 말하는 동안`}
                  situation="speaking"
                  value={animation.overrides[expression]?.speaking}
                  clips={animation.clips}
                  inherit
                  onChange={(value) => setOverride(expression, "speaking", value)}
                />
              </div>
            ))}
          </details>
        </div>
      </div>
    </section>
  );
}
