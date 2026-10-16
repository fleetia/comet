import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { Icon } from "@comet/icon";
import {
  Button,
  Checkbox,
  IconButton,
  SegmentedControl,
  Slider,
  Stepper,
  SHAPE_GROUPS,
  WidgetShapeGraphic,
  widgetShapePath,
  FREEFORM_SKIN_OUTLINES,
  type ShapePoint,
  type WidgetShape,
} from "@comet/ui";
import { command, errorText } from "../../hooks/useSnapshot";
import { widgetBackgroundUrl } from "../widgetAppearance";
import type { WidgetView } from "../types";
import { SHAPE_LIMITS, desktopSkin } from "./desktopShape";
import * as s from "./shapeEditor.css";

export function ShapeEditor({
  widget,
  value,
  onChange,
  onReset,
  disabled = false,
  onBusyChange,
}: {
  widget: WidgetView;
  value: WidgetShape;
  onChange: (shape: WidgetShape) => void;
  /** Restores the widget's own default shape. */
  onReset?: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const [tab, setTab] = useState<WidgetShape["source"]>(value.source);
  const [pointEditing, setPointEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const pointer = useRef<{ id: number; stroke: number; point?: number } | null>(null);
  const draftRef = useRef(value);
  draftRef.current = value;
  function change(patch: Partial<WidgetShape>): void {
    if (disabled || busy) return;
    onChange({ ...value, ...patch });
  }
  function chooseTab(source: WidgetShape["source"]): void {
    setTab(source);
    if (source !== "drawing" || value.strokes.length) change({ source });
  }
  function position(event: PointerEvent<SVGSVGElement>): ShapePoint {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(24, ((event.clientX - bounds.left) / bounds.width) * 24)),
      y: Math.max(0, Math.min(24, ((event.clientY - bounds.top) / bounds.height) * 24)),
    };
  }
  function start(event: PointerEvent<SVGSVGElement>): void {
    if (disabled || busy || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.target instanceof Element ? event.target.getAttribute("data-point") : null;
    if (pointEditing && target) {
      const [stroke, point] = target.split(":").map(Number);
      pointer.current = { id: event.pointerId, stroke, point };
    } else if (!pointEditing && value.strokes.length < 8) {
      pointer.current = { id: event.pointerId, stroke: value.strokes.length };
      const next = {
        ...value,
        source: "drawing" as const,
        strokes: [...value.strokes, [position(event)]],
      };
      draftRef.current = next;
      onChange(next);
    }
  }
  function move(event: PointerEvent<SVGSVGElement>): void {
    if (disabled || busy) return;
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const previous = draftRef.current;
    const strokes = previous.strokes.map((stroke) => [...stroke]);
    const point = position(event);
    if (active.point !== undefined) strokes[active.stroke][active.point] = point;
    else if (strokes[active.stroke].length < 256) strokes[active.stroke].push(point);
    const next = { ...previous, strokes };
    draftRef.current = next;
    onChange(next);
  }
  function end(): void {
    pointer.current = null;
    if (disabled || busy) return;
    const previous = draftRef.current;
    const strokes = previous.strokes.filter((stroke) => stroke.length >= 3);
    if (strokes.length !== previous.strokes.length) onChange({ ...previous, strokes });
  }
  function editPoints(): void {
    if (disabled || busy) return;
    if (value.source !== "drawing" || !value.strokes.length) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const skin = value.preset === "default" ? desktopSkin(widget.kind)?.skin : undefined;
      const native = skin ? FREEFORM_SKIN_OUTLINES[skin] : undefined;
      path.setAttribute("d", native?.d ?? widgetShapePath(value));
      if (typeof path.getTotalLength !== "function") {
        setError("이 화면에서는 모양의 점을 읽을 수 없어요. 직접 그리기를 사용해 주세요.");
        return;
      }
      const length = path.getTotalLength();
      const points = Array.from({ length: 48 }, (_, index) => {
        const point = path.getPointAtLength((length * index) / 48);
        return {
          x: Math.max(
            0,
            Math.min(24, native ? ((point.x + native.left) / native.width) * 24 : point.x),
          ),
          y: Math.max(
            0,
            Math.min(24, native ? ((point.y + native.top) / native.height) * 24 : point.y),
          ),
        };
      });
      change({ source: "drawing", strokes: [points] });
    }
    setTab("drawing");
    setPointEditing(true);
  }
  async function image(
    action: "choose_widget_background" | "remove_widget_background",
  ): Promise<void> {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const changed = await command<boolean>(action, {
        id: widget.id,
        expectedRevision: widget.revision,
      });
      if (changed && action === "choose_widget_background") change({ source: "image" });
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const cloud =
    value.preset === "cloud" || (widget.kind === "weather" && value.preset === "default");
  return (
    <fieldset className={s.editor} disabled={disabled || busy} aria-label="위젯 모양">
      <SegmentedControl
        className={s.tabs}
        label="모양 만들기"
        appearance="contained"
        disabled={disabled || busy}
        value={tab}
        options={[
          { value: "preset", label: "모양 목록" },
          { value: "drawing", label: "직접 그리기" },
          { value: "image", label: "이미지로" },
        ]}
        onValueChange={(source) => chooseTab(source as WidgetShape["source"])}
      />
      {tab === "preset" && (
        <div role="group" aria-label="모양 목록" className={s.presets}>
          {SHAPE_GROUPS.map((group) => (
            <div className={s.group} key={group.label}>
              <span>{group.label}</span>
              <div className={s.grid}>
                {group.items.map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    aria-label={label}
                    aria-pressed={
                      value.source === "preset" &&
                      (value.preset === preset ||
                        (widget.kind === "weather" &&
                          value.preset === "default" &&
                          preset === "cloud"))
                    }
                    className={s.choice}
                    onClick={() => change({ source: "preset", preset })}
                  >
                    <WidgetShapeGraphic preset={preset} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className={s.group}>
            <span>내 모양</span>
            <div className={s.customShapes}>
              {value.strokes.length > 0 && (
                <button
                  type="button"
                  className={s.choice}
                  aria-label="그린 모양 사용"
                  aria-pressed={value.source === "drawing"}
                  onClick={() => change({ source: "drawing" })}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
                    <path
                      d={widgetShapePath({ ...value, source: "drawing" })}
                      fill="currentColor"
                      fillOpacity="0.2"
                      stroke="currentColor"
                      strokeWidth="0.8"
                    />
                  </svg>
                </button>
              )}
              <IconButton
                icon="plus"
                className={s.addShape}
                aria-label="직접 그려서 내 모양 추가"
                onClick={() => {
                  setTab("drawing");
                  setPointEditing(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
      {tab === "drawing" && (
        <div role="group" aria-label="직접 그리기" className={s.drawing}>
          <p>
            {pointEditing ? "점을 끌어서 모양을 다듬어요." : "드래그해서 닫힌 모양을 그려 주세요."}
          </p>
          <svg
            className={s.canvas}
            viewBox="0 0 24 24"
            preserveAspectRatio="none"
            aria-label={pointEditing ? "모양 점 편집" : "모양 그리기 영역"}
            role="img"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <path
              d={widgetShapePath({ ...value, source: "drawing" })}
              fill="currentColor"
              fillOpacity="0.12"
              stroke="currentColor"
              strokeWidth="0.15"
            />
            {pointEditing &&
              value.strokes.map((stroke, strokeIndex) =>
                stroke.map((point, index) => (
                  <circle
                    key={`${strokeIndex}:${index}`}
                    data-point={`${strokeIndex}:${index}`}
                    cx={point.x}
                    cy={point.y}
                    r="0.3"
                    fill="currentColor"
                  />
                )),
              )}
          </svg>
          <div className={s.actions}>
            <Button
              size="small"
              variant="ghost"
              disabled={!value.strokes.length}
              onClick={() => change({ strokes: value.strokes.slice(0, -1) })}
            >
              마지막 획 취소
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={!value.strokes.length}
              onClick={() => change({ strokes: [] })}
            >
              지우기
            </Button>
            <Button
              size="small"
              variant={pointEditing ? "selected" : "ghost"}
              aria-pressed={pointEditing}
              onClick={() => (pointEditing ? setPointEditing(false) : editPoints())}
            >
              점 편집
            </Button>
          </div>
        </div>
      )}
      {tab === "image" && (
        <div role="group" aria-label="이미지로" className={s.drawing}>
          <p>이미지를 골라 현재 모양 안에 넣어요. 파일은 기존 위젯 자산으로 보관해요.</p>
          {widgetBackgroundUrl(widget) && (
            <img className={s.image} src={widgetBackgroundUrl(widget)!} alt="선택한 위젯 이미지" />
          )}
          <Button size="small" onClick={() => void image("choose_widget_background")}>
            이미지 선택
          </Button>
          <Button
            size="small"
            variant="ghost"
            disabled={!widgetBackgroundUrl(widget)}
            onClick={() => void image("remove_widget_background")}
          >
            이미지 제거
          </Button>
        </div>
      )}
      <div className={s.divider} />
      <div className={s.tuning}>
        <h3 className={s.tuningTitle}>{cloud ? "구름 다듬기" : "모양 다듬기"}</h3>
        <div className={s.row}>
          <span>크기</span>
          <span className={s.size}>
            <Stepper
              aria-label="모양 너비"
              size="compact"
              min={SHAPE_LIMITS.minWidth}
              max={SHAPE_LIMITS.maxWidth}
              value={value.width}
              disabled={disabled || busy}
              decreaseLabel="너비 줄이기"
              increaseLabel="너비 늘리기"
              onValueChange={(width) =>
                change({
                  width: Math.max(SHAPE_LIMITS.minWidth, Math.min(SHAPE_LIMITS.maxWidth, width)),
                })
              }
            />
            <span aria-hidden="true">×</span>
            <Stepper
              aria-label="모양 높이"
              size="compact"
              min={SHAPE_LIMITS.minHeight}
              max={SHAPE_LIMITS.maxHeight}
              value={value.height}
              disabled={disabled || busy}
              decreaseLabel="높이 줄이기"
              increaseLabel="높이 늘리기"
              onValueChange={(height) =>
                change({
                  height: Math.max(
                    SHAPE_LIMITS.minHeight,
                    Math.min(SHAPE_LIMITS.maxHeight, height),
                  ),
                })
              }
            />
          </span>
        </div>
        {cloud && (
          <>
            <div className={s.row}>
              <span>송이 수</span>
              <Stepper
                aria-label="송이 수"
                size="compact"
                min={2}
                max={8}
                value={value.cloudCount}
                disabled={disabled || busy}
                decreaseLabel="송이 수 줄이기"
                increaseLabel="송이 수 늘리기"
                onValueChange={(cloudCount) =>
                  change({ preset: "cloud", cloudCount: Math.max(2, Math.min(8, cloudCount)) })
                }
              />
            </div>
            <label className={s.row}>
              <span>몽글몽글</span>
              <span className={s.range}>
                <Slider
                  aria-label="몽글몽글"
                  min={0}
                  max={100}
                  value={value.roundness}
                  disabled={disabled || busy}
                  onChange={(event) =>
                    change({ preset: "cloud", roundness: event.currentTarget.valueAsNumber })
                  }
                />
                <span className={s.rangeValue} aria-hidden="true">
                  {value.roundness}%
                </span>
              </span>
            </label>
          </>
        )}
        <label className={s.row}>
          <span>회전</span>
          <span className={s.range}>
            <Slider
              aria-label="회전"
              min={-180}
              max={180}
              value={value.rotation}
              disabled={disabled || busy}
              onChange={(event) => change({ rotation: event.currentTarget.valueAsNumber })}
            />
            <span className={s.rangeValue} aria-hidden="true">
              {value.rotation}°
            </span>
          </span>
        </label>
        <div className={s.row}>
          <span>뒤집기</span>
          <div className={s.flips}>
            <Button
              className={s.flip}
              size="small"
              variant={value.flipX ? "selected" : "ghost"}
              aria-pressed={value.flipX}
              leadingIcon={<Icon name="flip" size={15} />}
              onClick={() => change({ flipX: !value.flipX })}
            >
              좌우
            </Button>
            <Button
              className={s.flip}
              size="small"
              variant={value.flipY ? "selected" : "ghost"}
              aria-pressed={value.flipY}
              leadingIcon={<Icon name="flip" size={15} />}
              onClick={() => change({ flipY: !value.flipY })}
            >
              상하
            </Button>
          </div>
        </div>
      </div>
      <div className={s.divider} />
      <div className={s.footer}>
        <Checkbox
          label="내용은 안쪽 여백에 맞추기"
          checked={value.fitContent}
          onChange={(event) => change({ fitContent: event.currentTarget.checked })}
        />
        <Button
          className={s.pointLink}
          size="small"
          variant="link"
          onClick={() => (onReset ? onReset() : change({ source: "preset", preset: "default" }))}
        >
          원래 모양으로
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
