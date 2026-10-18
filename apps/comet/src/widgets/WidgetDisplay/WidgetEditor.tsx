import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Button,
  Checkbox,
  IconButton,
  SegmentedControl,
  Stepper,
  Switch,
  Tabs,
  type WidgetShape,
} from "@comet/ui";
import { Icon } from "@comet/icon";
import { isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { transparentDocument } from "../../components/companion.css";
import { useWidgets } from "../useWidgets";
import { WidgetAppearance } from "../WidgetAppearance/WidgetAppearance";
import type { WidgetView } from "../types";
import { desktopSummary, desktopWidgets } from "./DesktopWidget";
import { defaultShape } from "./desktopShape";
import {
  DEFAULT_LAYOUT,
  desktopKind,
  STACK_WIDTH,
  useDesktopState,
  type DesktopLayout,
} from "./desktopState";
import { ShapeEditor } from "./ShapeEditor";
import { StackStyleEditor } from "./StackStyleEditor";
import * as s from "./widgetEditor.css";

/** Shape edits (drawing, sliders) arrive many times a second; save the settled value. */
export const SHAPE_SAVE_DELAY = 250;

const ANCHORS: [DesktopLayout["anchor"], string][] = [
  ["top-left", "왼쪽 위"],
  ["top-right", "오른쪽 위"],
  ["bottom-left", "왼쪽 아래"],
  ["bottom-right", "오른쪽 아래"],
];

/** Pixel width of the stack rows; out-of-range typing waits and is clamped on blur. */
function StackWidthField({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (width: number) => void;
}): ReactElement {
  const [draft, setDraft] = useState<number | string>(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const inRange = (width: number): boolean =>
    Number.isInteger(width) && width >= STACK_WIDTH.min && width <= STACK_WIDTH.max;
  function save(width: number): void {
    window.clearTimeout(timer.current);
    if (width !== value) onSave(width);
  }
  return (
    <span className={s.widthField}>
      <Stepper
        aria-label="모아두기 너비(px)"
        size="compact"
        min={STACK_WIDTH.min}
        max={STACK_WIDTH.max}
        step={10}
        value={draft}
        disabled={disabled}
        decreaseLabel="너비 줄이기"
        increaseLabel="너비 늘리기"
        onChange={(event) => {
          if (event.currentTarget.value === "") setDraft("");
        }}
        onValueChange={(width) => {
          setDraft(width);
          window.clearTimeout(timer.current);
          if (inRange(width))
            timer.current = window.setTimeout(() => save(width), SHAPE_SAVE_DELAY);
        }}
        onBlur={() => {
          const typed = Math.round(Number(draft));
          const width =
            Number.isFinite(typed) && draft !== ""
              ? Math.min(STACK_WIDTH.max, Math.max(STACK_WIDTH.min, typed))
              : value;
          setDraft(width);
          save(width);
        }}
      />
      <span aria-hidden="true">px</span>
    </span>
  );
}

export function WidgetEditor(): ReactElement {
  const { snapshot, error: widgetError } = useWidgets();
  const desktop = useDesktopState();
  const layout = desktop.state ?? DEFAULT_LAYOUT;
  const drag = useWindowDrag(isDesktop(), desktop.setError);
  const [tab, setTab] = useState<"shape" | "appearance">("shape");
  const [draft, setDraft] = useState<{ id: string; shape: WidgetShape } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pendingShape = useRef<{ id: string; shape: WidgetShape } | null>(null);
  const widgets = snapshot?.widgets ?? [];
  const available = desktopWidgets(widgets);
  const placed = layout.order
    .map((id) => available.find((widget) => widget.id === id))
    .filter((widget): widget is WidgetView => Boolean(widget));
  const addable = available.filter((widget) => !layout.order.includes(widget.id));
  const active = placed.find((widget) => widget.id === desktop.selected);
  const hasAppearance = Boolean(active && desktopKind(active.kind)?.appearance);
  const page = hasAppearance ? tab : "shape";
  const name = (widget: WidgetView): string =>
    snapshot?.catalog.find((entry) => entry.id === widget.kind)?.name ?? widget.kind;

  function saveShape(): void {
    window.clearTimeout(timer.current);
    const next = pendingShape.current;
    if (!next) return;
    pendingShape.current = null;
    void desktop
      .run("set_widget_desktop_shape", next)
      .then(() => setDraft((current) => (current?.shape === next.shape ? null : current)));
  }
  function changeShape(id: string, shape: WidgetShape): void {
    setDraft({ id, shape });
    pendingShape.current = { id, shape };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveShape, SHAPE_SAVE_DELAY);
  }
  const saveShapeRef = useRef(saveShape);
  saveShapeRef.current = saveShape;

  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    return () => {
      document.documentElement.classList.remove(transparentDocument);
      saveShapeRef.current();
    };
  }, []);
  useEffect(() => {
    saveShapeRef.current();
    setTab("shape");
  }, [desktop.selected]);

  function finish(): void {
    saveShape();
    void desktop.run("set_widget_desktop_editing", { editing: false });
  }

  const options =
    layout.mode === "stack" ? (
      <div className={s.options}>
        <div className={s.setting}>
          <span>기준 모서리</span>
          <div className={s.anchors} role="group" aria-label="기준 모서리">
            {ANCHORS.map(([anchor, label]) => (
              <button
                key={anchor}
                type="button"
                aria-label={label}
                aria-pressed={layout.anchor === anchor}
                disabled={desktop.busy}
                onClick={() => void desktop.configure({ anchor })}
              />
            ))}
          </div>
        </div>
        <div className={s.setting}>
          <span>너비</span>
          <StackWidthField
            value={layout.width}
            disabled={!desktop.state}
            onSave={(width) => void desktop.configure({ width })}
          />
        </div>
        <div className={s.setting}>
          <span>평소 모습</span>
          <SegmentedControl
            label="평소 모습"
            size="compact"
            value={layout.overlapped ? "folded" : "open"}
            disabled={desktop.busy}
            options={[
              { value: "open", label: "펼쳐 두기" },
              { value: "folded", label: "접어 두기" },
            ]}
            onValueChange={(value) => void desktop.configure({ overlapped: value === "folded" })}
          />
        </div>
        <Switch
          label="한 번에 하나만 펼치기"
          checked={layout.oneExpanded}
          disabled={desktop.busy}
          onChange={(event) => void desktop.configure({ oneExpanded: event.currentTarget.checked })}
        />
      </div>
    ) : (
      <div className={s.options}>
        <Checkbox
          label="격자에 맞추기"
          checked={layout.snapToGrid}
          disabled={desktop.busy}
          onChange={(event) => void desktop.configure({ snapToGrid: event.currentTarget.checked })}
        />
        <Checkbox
          label="다른 위젯에 맞추기"
          checked={layout.showGuides !== false}
          disabled={desktop.busy}
          onChange={(event) => void desktop.configure({ showGuides: event.currentTarget.checked })}
        />
      </div>
    );

  return (
    <main className={s.window} aria-label="바탕화면 위젯 편집">
      <div className={s.panel}>
        <header
          className={s.header}
          onPointerDown={(event) => {
            if (!(event.target instanceof Element) || !event.target.closest("button"))
              drag.onPointerDown(event);
          }}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.reset}
          onPointerCancel={drag.reset}
        >
          <h1>바탕화면 위젯 편집</h1>
          <IconButton icon="close" aria-label="편집 끝내기" onClick={finish} />
        </header>
        <div className={s.body}>
          <section className={s.section} aria-label="배치 방식">
            <SegmentedControl
              label="배치 방식"
              appearance="contained"
              value={layout.mode}
              disabled={desktop.busy || !desktop.state}
              options={[
                { value: "stack", label: "모아두기" },
                { value: "freeform", label: "자유 배치" },
              ]}
              onValueChange={(mode) =>
                void desktop.configure({ mode: mode as DesktopLayout["mode"] })
              }
            />
          </section>
          {active ? (
            <section className={s.section} aria-label={`${name(active)} 꾸미기`}>
              <div className={s.selection}>
                <Icon name={desktopSummary(active, Date.now(), widgets).icon} size={16} />
                <strong>{name(active)}</strong>
                <Button size="small" variant="ghost" onClick={() => desktop.select(null)}>
                  선택 해제
                </Button>
              </div>
              {layout.mode === "stack" ? (
                <StackStyleEditor
                  key={active.id}
                  id={active.id}
                  value={layout.stackStyles?.[active.id]}
                  disabled={!desktop.state}
                  onSave={(id, style) => void desktop.run("set_widget_stack_style", { id, style })}
                />
              ) : (
                <Tabs
                  label="위젯 꾸미기"
                  value={page}
                  onValueChange={(value) => setTab(value as "shape" | "appearance")}
                  items={[
                    {
                      value: "shape",
                      label: "모양",
                      content: (
                        <ShapeEditor
                          key={active.id}
                          widget={active}
                          value={
                            draft?.id === active.id
                              ? draft.shape
                              : (layout.shapes[active.id] ?? defaultShape(active))
                          }
                          disabled={!desktop.state}
                          onChange={(shape) => changeShape(active.id, shape)}
                          onReset={() => {
                            window.clearTimeout(timer.current);
                            pendingShape.current = null;
                            setDraft(null);
                            void desktop.run("set_widget_desktop_shape", {
                              id: active.id,
                              shape: null,
                            });
                          }}
                        />
                      ),
                    },
                    ...(hasAppearance
                      ? [
                          {
                            value: "appearance",
                            label: "색상·글자",
                            content: <WidgetAppearance key={active.id} widget={active} compact />,
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              <details className={s.more}>
                <summary>{layout.mode === "stack" ? "모아두기 설정" : "자유 배치 설정"}</summary>
                {options}
              </details>
            </section>
          ) : (
            <section
              className={s.section}
              aria-label={layout.mode === "stack" ? "모아두기 설정" : "자유 배치 설정"}
            >
              <p className={s.hint}>
                {layout.mode === "stack"
                  ? "모아두기의 위젯을 누르면 색상과 모서리를 바꿀 수 있어요."
                  : "바탕화면의 위젯을 누르면 모양과 색상을 바꿀 수 있어요."}
              </p>
              {options}
            </section>
          )}
          <section className={s.section} aria-label="위젯 추가">
            <h2>위젯 추가</h2>
            {addable.length === 0 ? (
              <p className={s.hint}>
                {available.length === 0
                  ? "설치하고 켠 바탕화면 위젯이 없어요."
                  : "켜 둔 위젯을 모두 바탕화면에 놓았어요."}
              </p>
            ) : (
              <ul className={s.addList}>
                {addable.map((widget) => (
                  <li key={widget.id}>
                    <span>
                      <Icon name={desktopSummary(widget, Date.now(), widgets).icon} size={15} />
                      {name(widget)}
                    </span>
                    <Button
                      size="small"
                      variant="ghost"
                      aria-label={`${name(widget)} 바탕화면에 놓기`}
                      disabled={desktop.busy}
                      onClick={() => void desktop.run("add_widget_desktop_item", { id: widget.id })}
                    >
                      <Icon name="plus" size={14} />
                      놓기
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className={s.quiet}>
            <Icon name="moon" size={13} />
            편집하는 동안 친구들은 쉬어요.
          </p>
          {(desktop.error || widgetError) && (
            <p className={s.error} role="alert">
              {desktop.error || widgetError}
            </p>
          )}
        </div>
        <footer className={s.footer}>
          <Button
            variant="ghost"
            size="small"
            disabled={desktop.busy || !desktop.state}
            onClick={() => {
              window.clearTimeout(timer.current);
              pendingShape.current = null;
              setDraft(null);
              void desktop.restore();
            }}
          >
            되돌리기
          </Button>
          <Button size="small" onClick={finish}>
            완료
          </Button>
        </footer>
      </div>
    </main>
  );
}
