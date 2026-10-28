import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, ChevIcon, type IconName } from "@comet/icon";
import { Button, ContextMenu, SearchInput, Switch, type ContextMenuAction } from "@comet/ui";
import type { WidgetView } from "../types";
import * as styles from "./widgetCatalog.css";

export type WidgetListEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  reaction: boolean;
  status: WidgetView["status"] | "draft";
  attention: boolean;
};
export const WIDGET_ICONS: Record<string, IconName> = {
  todo: "todo",
  calendar: "calendar",
  "focus-timer": "timer",
  "completion-jar": "marble",
  preparation: "envelope",
  clock: "clock",
  memo: "memo",
  weather: "cloud",
  music: "music",
  device: "battery",
  "external-notice": "balloon",
  interaction: "poke",
  "small-match": "dice",
  guessing: "cupdown",
  fishing: "fish",
  plant: "plant",
  pet: "paw",
  fortune: "crystal",
  ball: "ball2",
  "paper-plane": "plane",
  bubbles: "bubble",
};
const STATUS: Record<WidgetListEntry["status"], string> = {
  "install-error": "설치 오류",
  setup: "설정 필요",
  error: "오류",
  enabled: "켜짐",
  draft: "실행 검사 대기",
};
const GROUPS = [
  ["daily", "하루 도구"],
  ["play", "놀이 상자"],
  ["information", "생활 정보"],
  ["generated", "AI·가져온 위젯"],
] as const;
const PLAY_ORDER = ["interaction", "small-match", "fortune", "ball", "paper-plane", "bubbles"];
export function WidgetCatalog({
  entries,
  selectedId,
  onSelect,
  onToggle,
  onEditDesktop,
  menuActions,
  onMenuAction,
  disabled = false,
  children,
}: {
  entries: WidgetListEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onToggle?: (id: string, checked: boolean) => void;
  onEditDesktop?: () => void;
  menuActions?: (id: string) => ContextMenuAction[];
  onMenuAction?: (id: string, action: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}): ReactElement {
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent): void {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  function showMenu(id: string, x: number, y: number, trigger: HTMLButtonElement | null): void {
    if (menuActions?.(id).length) {
      menuTrigger.current = trigger;
      setMenu({ id, x, y });
    }
  }
  function closeMenu(): void {
    setMenu(null);
    menuTrigger.current?.focus();
  }
  const query = search.trim().toLocaleLowerCase();
  const groupOf = (item: WidgetListEntry): string =>
    item.id === "clock" ? "daily" : item.category;
  const matching = entries.filter((item) =>
    `${item.name} ${item.description} ${GROUPS.find(([id]) => id === groupOf(item))?.[1] || ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  function group(id: string): ReactNode {
    const items = matching
      .filter((item) => groupOf(item) === id)
      .sort((left, right) =>
        id === "play" ? PLAY_ORDER.indexOf(left.id) - PLAY_ORDER.indexOf(right.id) : 0,
      );
    if (!items.length) return null;
    const label = GROUPS.find(([key]) => key === id)![1];
    return (
      <section className={styles.group} aria-label={label} key={id}>
        <h2 className={styles.groupHeading}>
          {label}
          <span>{items.length}</span>
        </h2>
        <div className={styles.rows}>
          {items.map((item) => (
            <div
              className={styles.entry}
              key={item.id}
              onContextMenu={(event) => {
                event.preventDefault();
                showMenu(
                  item.id,
                  event.clientX,
                  event.clientY,
                  event.currentTarget.querySelector("button"),
                );
              }}
            >
              <button
                type="button"
                className={styles.entryButton}
                aria-label={`${item.name} ${STATUS[item.status]}`}
                aria-pressed={selectedId === item.id}
                onClick={() => onSelect(item.id)}
                aria-haspopup={menuActions?.(item.id).length ? "menu" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    showMenu(item.id, bounds.left, bounds.bottom, event.currentTarget);
                  }
                }}
              >
                <span className={styles.iconTile}>
                  <Icon name={WIDGET_ICONS[item.id] || "hash"} size={18} />
                </span>
                <span className={styles.entryCopy}>
                  <strong className={styles.entryName}>{item.name}</strong>
                  <span className={styles.description}>
                    {item.attention ? STATUS[item.status] : item.description}
                  </span>
                </span>
                <ChevIcon size={14} />
              </button>
              <Switch
                aria-label={`${item.name} 캐릭터 반응`}
                checked={item.reaction}
                disabled={disabled || !onToggle}
                onChange={(event) => onToggle?.(item.id, event.target.checked)}
              />
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className={styles.catalog} aria-label="위젯 목록">
      <header className={styles.title}>
        <div className={styles.headingCopy}>
          <h1>위젯</h1>
          <p>모두 {entries.length}개 · 캐릭터가 반응할지 정하거나, 눌러서 자세히 정해요</p>
        </div>
        <div className={styles.toolbar}>
          <SearchInput
            aria-label="위젯 검색"
            placeholder="위젯 찾기"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="primary" disabled={disabled || !onEditDesktop} onClick={onEditDesktop}>
            <Icon name="edit" size={15} />
            바탕화면 위젯 편집
          </Button>
        </div>
      </header>
      <div className={styles.list}>
        <div className={styles.column}>{group("daily")}</div>
        <div className={styles.column}>{group("play")}</div>
        <div className={styles.column}>
          {group("information")}
          {group("generated")}
          {children}
        </div>
      </div>
      {matching.length === 0 && (
        <p className={styles.empty}>찾는 위젯이 없어요. 검색어를 바꿔 보세요.</p>
      )}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 260)),
              top: Math.max(
                8,
                Math.min(
                  menu.y,
                  window.innerHeight -
                    Math.min(
                      (menuActions?.(menu.id).length || 1) * 36 + 24,
                      window.innerHeight - 16,
                    ),
                ),
              ),
              zIndex: 1000,
              maxHeight: "calc(100vh - 16px)",
              overflowY: "auto",
            }}
          >
            <ContextMenu
              label={`${entries.find((entry) => entry.id === menu.id)?.name || "위젯"} 관리`}
              actions={menuActions?.(menu.id) || []}
              onAction={(action) => {
                closeMenu();
                onMenuAction?.(menu.id, action);
              }}
              onDismiss={closeMenu}
            />
          </div>,
          document.body,
        )}
    </section>
  );
}
