import { useState, type ReactElement, type ReactNode } from "react";
import { Icon, ChevIcon, type IconName } from "@comet/icon";
import { SearchInput, Switch } from "@comet/ui";
import type { WidgetView } from "../types";
import * as styles from "./widgetCatalog.css";

export type WidgetListEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
  enabled?: boolean;
  status: WidgetView["status"] | "draft";
  attention: boolean;
};
export const WIDGET_ICONS: Record<string, IconName> = {
  todo: "todo",
  calendar: "calendar",
  "focus-timer": "timer",
  preparation: "envelope",
  clock: "clock",
  memo: "memo",
  weather: "cloud",
  music: "music",
  interaction: "poke",
  "small-match": "dice",
  fortune: "crystal",
  ball: "ball2",
  "paper-plane": "plane",
  bubbles: "bubble",
};
const STATUS: Record<WidgetListEntry["status"], string> = {
  "not-installed": "미설치",
  "install-error": "설치 오류",
  disabled: "꺼짐",
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
export function WidgetCatalog({
  entries,
  selectedId,
  onSelect,
  onToggle,
  disabled = false,
  children,
}: {
  entries: WidgetListEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onToggle?: (id: string, checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}): ReactElement {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const groupOf = (item: WidgetListEntry): string =>
    item.id === "clock" ? "daily" : item.category;
  const matching = entries.filter((item) =>
    `${item.name} ${item.description} ${GROUPS.find(([id]) => id === groupOf(item))?.[1] || ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  function group(id: string): ReactNode {
    const items = matching.filter((item) => groupOf(item) === id);
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
            <div className={styles.entry} key={item.id}>
              <button
                type="button"
                className={styles.entryButton}
                aria-label={`${item.name} ${STATUS[item.status]}`}
                aria-pressed={selectedId === item.id}
                onClick={() => onSelect(item.id)}
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
                aria-label={`${item.name} 사용`}
                checked={item.installed && (item.enabled ?? item.status === "enabled")}
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
          <p>모두 {entries.length}개 · 켜고 끄거나, 눌러서 자세히 정해요</p>
        </div>
        <SearchInput
          aria-label="위젯 검색"
          placeholder="위젯 찾기"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
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
    </section>
  );
}
