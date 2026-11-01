import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "@comet/ui";
import { transparentDocument } from "../../components/companion.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { number, record, rows, text } from "../toolData";
import { useWidgets } from "../useWidgets";
import * as s from "./imageWindow.css";

const RESIZE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-8, 0],
  ArrowRight: [8, 0],
  ArrowUp: [0, -8],
  ArrowDown: [0, 8],
};

export function ImageWindow({ id, imageId }: { id: string; imageId: string }): ReactElement {
  const { snapshot, error } = useWidgets();
  const [failure, setFailure] = useState<string | null>(null);
  const [mediaFailure, setMediaFailure] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [playing, setPlaying] = useState(!reducedMotion);
  const video = useRef<HTMLVideoElement>(null);
  const pendingResize = useRef<{ dimensions: Record<string, unknown>; origin?: Promise<{ x: number; y: number } | null> }[]>([]);
  const resizeBusy = useRef(false);
  const resizing = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    hasPreview: boolean;
    origin: Promise<{ x: number; y: number } | null>;
  } | null>(null);
  const menu = useRef<Menu | null>(null);
  const drag = useWindowDrag(isDesktop(), setFailure);
  const widget = snapshot?.widgets.find((item) => item.id === id && item.kind === "image");
  const image = rows(record(widget?.data).images).find((item) => item.id === imageId);
  const width = number(image?.width);
  const height = number(image?.height);
  const imageNumber = rows(record(widget?.data).images).findIndex((item) => item.id === imageId) + 1;

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = (): void => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      video.current?.pause();
      setPlaying(false);
    }
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    return () => {
      document.documentElement.classList.remove(transparentDocument);
      void menu.current?.close();
    };
  }, []);

  async function run(name: string, extra: Record<string, unknown> = {}): Promise<void> {
    setFailure(null);
    try {
      await command(name, { id, imageId, ...extra });
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    }
  }

  function queueResize(dimensions: Record<string, unknown>, origin?: Promise<{ x: number; y: number } | null>): void {
    const queue = pendingResize.current;
    if (queue.at(-1)?.dimensions.preview === true) queue.pop();
    queue.push({ dimensions, origin });
    if (resizeBusy.current) return;
    resizeBusy.current = true;
    void (async () => {
      while (pendingResize.current.length > 0) {
        const next = pendingResize.current.shift();
        if (!next) break;
        try {
          const point = await next.origin;
          if (next.origin && !point) continue;
          await run("resize_widget_image", { resize: { ...next.dimensions, originX: point?.x, originY: point?.y } });
        } catch (cause: unknown) {
          setFailure(errorText(cause));
        }
      }
      resizeBusy.current = false;
    })();
  }

  async function remove(): Promise<void> {
    try {
      const result = await invoke<string>("plugin:dialog|message", {
        title: "이미지 지우기",
        message: "이미지를 지울까요? 지운 이미지는 되돌릴 수 없어요.",
        kind: "warning",
        buttons: { OkCancelCustom: ["지우기", "취소"] },
      });
      if (result === "지우기") await run("remove_widget_image");
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    }
  }

  async function openMenu(): Promise<void> {
    if (!image || !isDesktop()) return;
    try {
      await menu.current?.close();
      menu.current = await Menu.new({
        items: [
          {
            text: "크기 원래대로",
            action: () =>
              queueResize({
                width: number(image.naturalWidth),
                height: number(image.naturalHeight),
                restore: true,
              }),
          },
          { text: "바탕화면에서 빼기", action: () => void run("close_widget_image") },
          { text: "지우기", action: () => void remove() },
        ],
      });
      await menu.current.popup();
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    }
  }

  function startResize(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (event.button !== 0 || !image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const currentWindow = getCurrentWindow();
    const origin = Promise.all([currentWindow.outerPosition(), currentWindow.scaleFactor()])
      .then(([point, scale]) => ({ x: point.x / scale, y: point.y / scale }))
      .catch((cause: unknown) => { setFailure(errorText(cause)); return null; });
    resizing.current = {
      pointerId: event.pointerId,
      x: event.screenX,
      y: event.screenY,
      width,
      height,
      hasPreview: false,
      origin,
    };
  }

  function resize(event: PointerEvent<HTMLButtonElement>, preview: boolean): void {
    const start = resizing.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.screenX - start.x;
    const dy = event.screenY - start.y;
    if (dx === 0 && dy === 0 && !start.hasPreview) {
      if (!preview) resizing.current = null;
      return;
    }
    const naturalWidth = number(image?.naturalWidth);
    const naturalHeight = number(image?.naturalHeight);
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    const scale =
      Math.abs(dx / start.width) >= Math.abs(dy / start.height)
        ? (start.width + dx) / naturalWidth
        : (start.height + dy) / naturalHeight;
    const next = Math.max(scale, 48 / naturalWidth, 48 / naturalHeight);
    const dimensions = { width: naturalWidth * next, height: naturalHeight * next, preview };
    queueResize(dimensions, start.origin);
    if (preview) start.hasPreview = true;
    else resizing.current = null;
  }

  const src = image && isDesktop() ? convertFileSrc(`image:${imageId}`, "widget") : undefined;
  return (
    <main
      className={s.frame}
      aria-label={`이미지 위젯 ${imageNumber}`}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          void openMenu();
        }
      }}
      onPointerDown={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest("button"))
          drag.onPointerDown(event);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.reset}
      onPointerCancel={drag.reset}
      onContextMenu={(event) => {
        event.preventDefault();
        void openMenu();
      }}
    >
      {mediaFailure ? (
        <p className={s.mediaError} role="alert">표시할 수 없는 파일이에요. 이미지를 지우고 다시 추가해 주세요.</p>
      ) : src &&
        (text(image?.mime) === "video/mp4" ? (
          <video ref={video} className={s.media} src={src} autoPlay={!reducedMotion} loop muted playsInline onError={() => setMediaFailure(true)} />
        ) : (
          <img className={s.media} src={src} alt="" draggable={false} onError={() => setMediaFailure(true)} />
        ))}
      {image && (
        <>
          <IconButton
            className={`${s.control} ${s.close}`}
            icon="minus"
            aria-label="이미지 바탕화면에서 빼기"
            size="compact"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void run("close_widget_image")}
          />
          <IconButton
            className={`${s.control} ${s.more} ${mediaFailure ? s.visible : ""}`}
            icon="more"
            aria-label="더 보기"
            size="compact"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void openMenu()}
          />
          {text(image.mime) === "video/mp4" && !mediaFailure && (
            <IconButton
              className={`${s.control} ${s.play}`}
              icon={playing ? "pause" : "play"}
              aria-label={playing ? "영상 정지" : "영상 재생"}
              size="compact"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (playing) {
                  video.current?.pause();
                  setPlaying(false);
                } else {
                  void video.current?.play().then(() => setPlaying(true)).catch((cause: unknown) => setFailure(errorText(cause)));
                }
              }}
            />
          )}
          <button
            type="button"
            className={`${s.control} ${s.resize}`}
            aria-label="이미지 크기 조절"
            onPointerDown={startResize}
            onPointerMove={(event) => resize(event, true)}
            onPointerUp={(event) => resize(event, false)}
            onPointerCancel={() => {
              const origin = resizing.current?.origin;
              resizing.current = null;
              if (origin) queueResize({ width, height, preview: true, restore: true }, origin);
            }}
            onKeyDown={(event) => {
              const step = RESIZE_KEYS[event.key];
              if (!step) return;
              event.preventDefault();
              const naturalWidth = number(image.naturalWidth);
              const naturalHeight = number(image.naturalHeight);
              if (naturalWidth <= 0 || naturalHeight <= 0) return;
              const scale = step[0]
                ? (width + step[0]) / naturalWidth
                : (height + step[1]) / naturalHeight;
              const next = Math.max(scale, 48 / naturalWidth, 48 / naturalHeight);
              queueResize({
                width: naturalWidth * next,
                height: naturalHeight * next,
              });
            }}
          />
        </>
      )}
      {(failure || error) && (
        <p className={s.error} role="alert">
          {failure || error}
        </p>
      )}
    </main>
  );
}
