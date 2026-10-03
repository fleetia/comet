import {
  ActionBar,
  Button,
  ColorField,
  FormField,
  Heading,
  PlacementPicker,
  Surface,
  Text,
} from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import {
  appearanceInput,
  backgroundPosition,
  getWidgetAppearance,
  placementAlignment,
  placementLabel,
  widgetBackgroundUrl,
  type Placement,
  type WidgetAppearance,
} from "../widgetAppearance";
import * as s from "./widgetAppearance.css";

export function WidgetAppearance({
  widget,
  onDirtyChange,
  actionContainer,
  displayControls,
  active = true,
  disabled = false,
}: {
  widget: WidgetView;
  onDirtyChange?: (dirty: boolean) => void;
  actionContainer?: HTMLDivElement | null;
  displayControls?: ReactNode;
  active?: boolean;
  disabled?: boolean;
}): ReactElement {
  const [edited, setEdited] = useState<WidgetAppearance | null>(null);
  const baseline = getWidgetAppearance(widget.data);
  const draft = edited ?? baseline;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  function change(value: Partial<WidgetAppearance>): void {
    setEdited({ ...draft, ...value });
    setSaved(false);
  }
  const imageUrl = widgetBackgroundUrl(widget);

  async function save(): Promise<void> {
    if (!isDesktop()) {
      setError("표시 설정 저장은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    if (busy || disabled) {
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await command("configure_widget_appearance", {
        id: widget.id,
        expectedRevision: widget.revision,
        input: appearanceInput(draft),
      });
      setEdited(null);
      setSaved(true);
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function changeBackground(
    action: "choose_widget_background" | "remove_widget_background",
  ): Promise<void> {
    if (!isDesktop()) {
      setError("배경 이미지는 데스크톱 앱에서 선택할 수 있어요.");
      return;
    }
    if (busy || disabled) {
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await command(action, { id: widget.id, expectedRevision: widget.revision });
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function setPlacement(key: "backgroundPosition" | "textPosition", value: Placement): void {
    change({ [key]: value });
    setSaved(false);
  }

  const alignment = placementAlignment(draft.textPosition);
  const preview =
    widget.kind === "weather"
      ? { title: "서울", value: "23°C · 맑음" }
      : widget.kind === "device"
        ? { title: "배터리", value: "64%" }
        : { title: "시계·기념일", value: "14:20 · D-12" };
  const saveControls = (
    <div className={s.saveControls} hidden={!active}>
      <ActionBar
        className={s.saveBar}
        status={
          <div className={s.saveState}>
            <span>
              {dirty ? "변경사항 있음" : saved ? "표시 설정을 저장했어요." : "변경사항 없음"}
            </span>
            <Text variant="caption" tone="muted">
              배경·글자·위치 변경사항
            </Text>
          </div>
        }
      >
        <Button
          variant="secondary"
          aria-label="표시 변경 취소"
          disabled={busy || disabled || !dirty}
          onClick={() => {
            setEdited(null);
            setSaved(false);
          }}
        >
          표시 취소
        </Button>
        <Button
          variant="primary"
          aria-label="표시 설정 저장"
          disabled={busy || disabled || !dirty}
          onClick={() => void save()}
        >
          표시 저장
        </Button>
      </ActionBar>
      <Text variant="caption" tone="muted">
        이미지 선택·제거는 즉시 반영
      </Text>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">표시 설정을 처리하고 있어요.</p>}
    </div>
  );
  return (
    <section className={s.settings} aria-label="바탕화면 표시 설정">
      <div className={s.body}>
        {displayControls}
        <Surface tone="accent" className={s.previewSurface}>
          <Text variant="caption">미리보기</Text>
          <div
            className={s.preview}
            style={{
              backgroundColor: draft.backgroundColor,
              backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined,
              backgroundPosition: backgroundPosition(draft.backgroundPosition),
              color: draft.textColor,
              ...alignment,
            }}
          >
            <div className={s.previewText}>
              <strong className={s.previewTitle}>{preview.title}</strong>
              <span className={s.previewValue}>{preview.value}</span>
              <span className={s.previewCaption}>14:20 · 표시 설정 예시</span>
            </div>
          </div>
        </Surface>
        <Heading level={4} variant="subsection" className={s.editHeading}>
          표시 설정
        </Heading>
        <div className={s.colors}>
          <FormField label="배경 색상">
            <ColorField
              className={s.colorField}
              swatchLabel="배경 색상 선택"
              value={draft.backgroundColor}
              disabled={busy || disabled}
              onValueChange={(value) => change({ backgroundColor: value })}
            />
          </FormField>
          <FormField label="글자 색상">
            <ColorField
              className={s.colorField}
              swatchLabel="글자 색상 선택"
              value={draft.textColor}
              disabled={busy || disabled}
              onValueChange={(value) => change({ textColor: value })}
            />
          </FormField>
        </div>
        <div className={s.fileActions}>
          <Button
            variant="secondary"
            disabled={busy || disabled}
            onClick={() => void changeBackground("choose_widget_background")}
          >
            {imageUrl ? "배경 이미지 바꾸기" : "배경 이미지 선택"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || disabled || !imageUrl}
            onClick={() => void changeBackground("remove_widget_background")}
          >
            이미지 제거
          </Button>
          <Text variant="caption" tone="muted">
            {imageUrl ? "선택됨" : "선택 없음"}
          </Text>
        </div>
        <div className={s.positions}>
          <div className={s.placementField}>
            <strong>이미지 위치</strong>
            <PlacementPicker
              className={s.placementPicker}
              label="배경 이미지 위치"
              value={draft.backgroundPosition}
              disabled={busy || disabled}
              getItemLabel={placementLabel}
              onValueChange={(value) => setPlacement("backgroundPosition", value)}
            />
          </div>
          <div className={s.placementField}>
            <strong>글자 위치</strong>
            <PlacementPicker
              className={s.placementPicker}
              label="글자 위치"
              value={draft.textPosition}
              disabled={busy || disabled}
              getItemLabel={placementLabel}
              onValueChange={(value) => setPlacement("textPosition", value)}
            />
          </div>
        </div>
      </div>
      {actionContainer ? createPortal(saveControls, actionContainer) : saveControls}
    </section>
  );
}
