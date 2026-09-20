import { Button, ColorField, FormField, PlacementPicker } from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
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
}: {
  widget: WidgetView;
  onDirtyChange?: (dirty: boolean) => void;
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
    if (busy) {
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
    if (busy) {
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
      ? { title: "서울", value: "23°C" }
      : widget.kind === "device"
        ? { title: "배터리", value: "64%" }
        : { title: "기념일", value: "D-12" };
  return (
    <section className={s.settings} aria-label="바탕화면 표시 설정">
      <p className={s.description}>
        별도 창에 보여 줄 배경과 글자 위치를 정합니다. 이미지를 고르지 않으면 배경 색상이 사용돼요.
      </p>
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
          <strong>{preview.title}</strong>
          <span>{preview.value}</span>
        </div>
      </div>
      <div className={s.colors}>
        <FormField label="배경 색상">
          <ColorField
            value={draft.backgroundColor}
            disabled={busy}
            onValueChange={(value) => change({ backgroundColor: value })}
          />
        </FormField>
        <FormField label="글자 색상">
          <ColorField
            value={draft.textColor}
            disabled={busy}
            onValueChange={(value) => change({ textColor: value })}
          />
        </FormField>
      </div>
      <div className={s.positions}>
        <PlacementPicker
          label="배경 이미지 위치"
          value={draft.backgroundPosition}
          disabled={busy}
          getItemLabel={placementLabel}
          onValueChange={(value) => setPlacement("backgroundPosition", value)}
        />
        <PlacementPicker
          label="글자 위치"
          value={draft.textPosition}
          disabled={busy}
          getItemLabel={placementLabel}
          onValueChange={(value) => setPlacement("textPosition", value)}
        />
      </div>
      <div className={s.fileActions}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void changeBackground("choose_widget_background")}
        >
          {imageUrl ? "배경 이미지 바꾸기" : "배경 이미지 선택"}
        </Button>
        {imageUrl && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void changeBackground("remove_widget_background")}
          >
            이미지 제거
          </Button>
        )}
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
          표시 설정 저장
        </Button>
        {dirty && (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setEdited(null);
              setSaved(false);
            }}
          >
            표시 변경 취소
          </Button>
        )}
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {saved && <p className={s.saved}>표시 설정을 저장했어요.</p>}
      {busy && <p role="status">표시 설정을 처리하고 있어요.</p>}
    </section>
  );
}
