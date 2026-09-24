import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Button, Checkbox, FormField, Select, TextArea, TextField } from "@fleetia/lagrange";
import type {
  AnimationAsset,
  AnimationBinding,
  CharacterDefinition,
  InstalledCharacter,
  ReactionPreview,
  ReactionRule,
  ReactionVariant,
} from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useAnimationFrames } from "../../hooks/useAnimationFrames";
import { useAnimationPlayer } from "../../hooks/useAnimationPlayer";
import { AnimationFrameView } from "../AnimationFrameView/AnimationFrameView";
import { animationAssetUrl, animationBinding } from "../characterAnimation";
import { DEFAULT_EXPRESSION, spriteSource } from "../characterIdentity";
import { MotionSelect } from "../MotionSelect/MotionSelect";
import { reactionError } from "./reactionValidation";
import * as common from "../characters.css";
import * as s from "./reactionEditor.css";

type EventOption = { event: string; label: string };
const GESTURES: EventOption[] = [
  { event: "click", label: "클릭" },
  { event: "grab-start", label: "잡기 시작" },
  { event: "release", label: "놓기" },
];
type Preview = { key: string; sequence: number; event: string; result: ReactionPreview };

export function ReactionEditor({
  definition,
  character,
  assets,
  visible,
  onChange,
}: {
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  assets: AnimationAsset[];
  visible: boolean;
  onChange: (reactions: ReactionRule[]) => void;
}): JSX.Element {
  const [events, setEvents] = useState(GESTURES);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventToAdd, setEventToAdd] = useState("click");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const key = JSON.stringify([definition, visible, busy]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const rules = definition.reactions ?? [];
  const clips = definition.animation?.clips ?? [];
  const available = events.filter(({ event }) => !rules.some((rule) => rule.event === event));
  const nextEvent =
    available.find(({ event }) => event === eventToAdd)?.event ?? available[0]?.event;
  const validationError = reactionError(definition);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void command<EventOption[]>("get_character_reaction_events")
      .then((items) => {
        if (active && Array.isArray(items)) setEvents(items);
      })
      .catch((cause: unknown) => {
        if (active) setEventError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    sequence.current += 1;
    setPreview(null);
    setPending(false);
    setError(null);
    return () => {
      sequence.current += 1;
    };
  }, [key]);

  async function simulate(event: string, variantIndex?: number): Promise<void> {
    if (!isDesktop()) return;
    const request = ++sequence.current;
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      const result = await command<ReactionPreview>("preview_character_reaction", {
        definition,
        event,
        busy,
        ...(variantIndex === undefined ? {} : { variantIndex }),
      });
      if (sequence.current === request && currentKey.current === key)
        setPreview({ key, sequence: request, event, result });
    } catch (cause) {
      if (sequence.current === request && currentKey.current === key) setError(errorText(cause));
    } finally {
      if (sequence.current === request) setPending(false);
    }
  }
  function updateRule(id: string, update: Partial<ReactionRule>): void {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...update } : rule)));
  }
  function updateVariant(rule: ReactionRule, id: string, update: Partial<ReactionVariant>): void {
    updateRule(rule.id, {
      variants: rule.variants.map((variant) =>
        variant.id === id ? { ...variant, ...update } : variant,
      ),
    });
  }
  const active = preview?.key === key ? preview : null;
  const selection = active?.result.selection;
  const expression = selection?.variant.expression ?? DEFAULT_EXPRESSION;
  const motion = selection?.variant.motion;
  let binding: AnimationBinding | null | undefined;
  if (motion?.mode === "clip") binding = motion;
  else if (motion?.mode === "static") binding = null;
  else if (selection) {
    binding = animationBinding(
      definition.animation,
      expression,
      selection.speechAllowed && selection.variant.text ? "speaking" : "idle",
    );
    if (binding === undefined) binding = animationBinding(definition.animation, expression, "idle");
  }
  const clip = clips.find((item) => item.id === binding?.clipId);
  const size = Math.max(32, Math.min(128, definition.spriteSize));
  const sources = useMemo(() => {
    const pendingAssets = new Map(assets.map((asset) => [asset.assetId, asset]));
    return Object.fromEntries(
      (clip?.frames ?? []).map(({ assetId }) => {
        const asset = pendingAssets.get(assetId);
        return [
          assetId,
          asset
            ? `data:${asset.mime};base64,${asset.data}`
            : character
              ? animationAssetUrl(character.id, assetId)
              : "",
        ];
      }),
    );
  }, [assets, character?.id, clip?.frames]);
  const loaded = useAnimationFrames(active ? clip : undefined, sources, size);
  const player = useAnimationPlayer({
    clip,
    binding: binding ?? undefined,
    runKey: String(active?.sequence ?? 0),
    enabled: Boolean(active && visible),
    ready: loaded.ready,
  });
  const image = spriteSource(character, expression);
  return (
    <section className={common.section} aria-label="행동 반응">
      <h3 className={common.subheading}>행동에 반응하기</h3>
      <p className={common.small}>
        사건마다 대사·표정·동작을 한 묶음으로 고르며 캐릭터 저장으로 반영해요. 비운 대사는 말하지
        않고 비운 표정은 현재 표정을 따라요.
      </p>
      {definition.animation?.bindings.click && rules.some((rule) => rule.event === "click") && (
        <p className={common.small}>
          클릭 반응을 등록하면 모습·표정의 기존 클릭 동작 대신 이 반응을 사용해요.
        </p>
      )}
      {rules.map((rule, ruleIndex) => (
        <div className={s.rule} key={rule.id}>
          <div className={s.controls}>
            <Select
              aria-label={`반응 ${ruleIndex + 1} 사건`}
              value={rule.event}
              onChange={(event) =>
                updateRule(rule.id, {
                  event: event.target.value,
                  variants: rule.variants.map((variant) =>
                    variant.motion?.mode === "clip" && event.target.value !== "grab-start"
                      ? { ...variant, motion: { ...variant.motion, repeat: false, intervalMs: 0 } }
                      : variant,
                  ),
                })
              }
            >
              {!events.some(({ event }) => event === rule.event) && (
                <option value={rule.event}>{rule.event}</option>
              )}
              {events
                .filter(
                  ({ event }) =>
                    event === rule.event || !rules.some((other) => other.event === event),
                )
                .map(({ event, label }) => (
                  <option key={event} value={event}>
                    {label}
                  </option>
                ))}
            </Select>
            <Button
              variant="quiet"
              size="compact"
              type="button"
              aria-label={`반응 ${ruleIndex + 1} 삭제`}
              onClick={() => onChange(rules.filter((other) => other.id !== rule.id))}
            >
              반응 삭제
            </Button>
          </div>
          {rule.variants.map((variant, index) => {
            const label = `반응 ${ruleIndex + 1} 후보 ${index + 1}`;
            return (
              <div className={s.variant} key={variant.id}>
                <div className={s.controls}>
                  <span>후보 {index + 1}</span>
                  <Select
                    aria-label={`${label} 표정`}
                    value={variant.expression ?? "$current"}
                    onChange={(event) =>
                      updateVariant(rule, variant.id, {
                        expression:
                          event.target.value === "$current" ? undefined : event.target.value,
                      })
                    }
                  >
                    <option value="$current">현재 표정 사용</option>
                    {variant.expression && !(variant.expression in definition.expressions) && (
                      <option value={variant.expression}>없는 표정 · 다시 선택</option>
                    )}
                    {Object.keys(definition.expressions).map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </Select>
                  <Button
                    variant="quiet"
                    size="compact"
                    type="button"
                    disabled={rule.variants.length <= 1}
                    aria-label={`${label} 삭제`}
                    onClick={() =>
                      updateRule(rule.id, {
                        variants: rule.variants.filter((other) => other.id !== variant.id),
                      })
                    }
                  >
                    후보 삭제
                  </Button>
                </div>
                <TextArea
                  aria-label={`${label} 대사`}
                  placeholder="말하지 않으려면 비워 두세요."
                  rows={2}
                  maxLength={500}
                  value={variant.text ?? ""}
                  onChange={(event) =>
                    updateVariant(rule, variant.id, {
                      text: event.target.value === "" ? undefined : event.target.value,
                    })
                  }
                />
                <MotionSelect
                  label={label}
                  value={variant.motion}
                  clips={clips}
                  once={rule.event !== "grab-start"}
                  onChange={(motion) => updateVariant(rule, variant.id, { motion })}
                />
                <Button
                  variant="quiet"
                  size="compact"
                  type="button"
                  disabled={!isDesktop() || pending || Boolean(validationError)}
                  aria-label={`${label} 미리보기`}
                  onClick={() => void simulate(rule.event, index)}
                >
                  이 후보 미리보기
                </Button>
              </div>
            );
          })}
          <Button
            variant="secondary"
            size="compact"
            type="button"
            disabled={rule.variants.length >= 16}
            aria-label={`반응 ${ruleIndex + 1} 후보 추가`}
            onClick={() =>
              updateRule(rule.id, { variants: [...rule.variants, { id: crypto.randomUUID() }] })
            }
          >
            후보 추가
          </Button>
          <details className={s.advanced}>
            <summary>추가 설정</summary>
            <FormField label="대사 쿨다운(초)">
              <TextField
                className={s.cooldown}
                aria-label={`반응 ${ruleIndex + 1} 대사 쿨다운(초)`}
                type="number"
                min={0}
                max={60}
                step={0.1}
                value={rule.cooldownMs / 1000}
                onChange={(event) =>
                  updateRule(rule.id, { cooldownMs: Math.round(Number(event.target.value) * 1000) })
                }
              />
            </FormField>
            <p className={common.small}>
              대사를 실제 보여 준 뒤 다시 말하기까지 쉬는 시간이에요. 동작은 다시 실행할 수 있어요.
            </p>
          </details>
        </div>
      ))}
      <div className={s.controls}>
        <Select
          aria-label="추가할 반응 사건"
          value={nextEvent ?? ""}
          disabled={!nextEvent}
          onChange={(event) => setEventToAdd(event.target.value)}
        >
          {!nextEvent && <option value="">모든 사건에 반응을 등록했어요.</option>}
          {available.map(({ event, label }) => (
            <option key={event} value={event}>
              {label}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="compact"
          type="button"
          disabled={!nextEvent || rules.length >= 32}
          onClick={() => {
            if (nextEvent)
              onChange([
                ...rules,
                {
                  id: crypto.randomUUID(),
                  event: nextEvent,
                  variants: [{ id: crypto.randomUUID() }],
                  cooldownMs: 3000,
                },
              ]);
          }}
        >
          반응 추가
        </Button>
      </div>
      {eventError && (
        <p className={common.small} role="status">
          사건 목록을 불러오지 못했어요. {eventError}
        </p>
      )}
      {validationError && (
        <p className={common.small} role="alert">
          {validationError}
        </p>
      )}
      <div className={s.rule}>
        <h4 className={common.subheading}>반응 미리보기</h4>
        <div className={s.controls}>
          <Checkbox checked={busy} onChange={(event) => setBusy(event.target.checked)}>
            대화 중인 상황
          </Checkbox>
          {GESTURES.map(({ event, label }) => (
            <Button
              key={event}
              variant="secondary"
              size="compact"
              type="button"
              disabled={!isDesktop() || pending || Boolean(validationError)}
              onClick={() => void simulate(event)}
            >
              {label} 시험
            </Button>
          ))}
          <Button
            variant="quiet"
            size="compact"
            type="button"
            disabled={!preview && !pending}
            onClick={() => {
              sequence.current += 1;
              setPreview(null);
              setPending(false);
            }}
          >
            반응 미리보기 정지
          </Button>
        </div>
        {!isDesktop() && (
          <p className={common.small}>행동 판정 미리보기는 데스크톱 앱에서 사용할 수 있어요.</p>
        )}
        {active && (
          <div className={s.preview}>
            {player.frameIndex !== null ? (
              <AnimationFrameView
                frames={loaded.frames}
                index={player.frameIndex}
                size={size}
                label="반응 동작 미리보기"
              />
            ) : (
              <span className={s.sprite} style={{ width: size, height: size }}>
                {image ? (
                  <img className={s.image} src={image} alt="반응 표정 미리보기" />
                ) : (
                  (definition.expressions[expression] ?? definition.expressions[DEFAULT_EXPRESSION])
                )}
              </span>
            )}
            {selection ? (
              <div>
                <p className={common.small}>
                  선택한 반응:{" "}
                  {events.find(({ event }) => event === active.event)?.label ?? active.event}
                </p>
                {selection.speechAllowed && selection.variant.text && (
                  <p className={s.speech} aria-label="반응 대사 미리보기">
                    {selection.variant.text}
                  </p>
                )}
              </div>
            ) : (
              <p className={common.small}>연결한 반응이 없어요.</p>
            )}
            {active.result.speechReason && (
              <p className={common.small} role="status">
                {active.result.speechReason}
              </p>
            )}
          </div>
        )}
        {(error || loaded.error) && (
          <p className={common.small} role="alert">
            {error || loaded.error}
          </p>
        )}
      </div>
    </section>
  );
}
