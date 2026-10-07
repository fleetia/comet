import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { SelectableListRow, Surface, Text, TextField } from "@fleetia/lagrange";
import type { WidgetView } from "../types";
import * as styles from "./widgetCatalog.css";

export type WidgetListEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
  status: WidgetView["status"] | "draft";
  attention: boolean;
};

const GROUPS = [
  ["daily", "하루 도구"],
  ["play", "놀이 상자"],
  ["information", "생활 정보"],
  ["generated", "AI·가져온 위젯"],
] as const;
const STATUS: Record<WidgetListEntry["status"], string> = {
  "not-installed": "미설치",
  "install-error": "설치 오류",
  disabled: "꺼짐",
  setup: "설정 필요",
  error: "오류",
  enabled: "켜짐",
  draft: "실행 검사 대기",
};
const STORAGE_KEY = "comet.widget-groups";

function readExpanded(selected?: WidgetListEntry): Record<string, boolean> {
  const defaults = {
    daily: true,
    generated: true,
    ...(selected ? { [selected.category]: true } : {}),
  };
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      return Object.fromEntries(GROUPS.map(([id]) => [id, Reflect.get(stored, id) === true]));
    }
  } catch {
    // An unavailable browser store must not prevent browsing widgets.
  }
  return defaults;
}

export function WidgetCatalog({
  entries,
  selectedId,
  onSelect,
  children,
}: {
  entries: WidgetListEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
  children?: ReactNode;
}): ReactElement {
  const prefix = useId();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() =>
    readExpanded(entries.find((item) => item.id === selectedId)),
  );
  const [searchCollapse, setSearchCollapse] = useState<{ query: string; groups: string[] }>({
    query: "",
    groups: [],
  });
  const previousSelection = useRef(selectedId);
  const selectedGroupId = entries.find((item) => item.id === selectedId)?.category;
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      // Folding still works for this window when storage is unavailable.
    }
  }, [expanded]);
  const query = search.trim().toLocaleLowerCase();
  const isSearching = query.length > 0;
  const installedCount = entries.filter((item) => item.installed).length;
  const matching = entries.filter((item) => {
    const groupName = GROUPS.find(([id]) => id === item.category)?.[1] ?? "";
    return `${item.name} ${item.description} ${groupName}`.toLocaleLowerCase().includes(query);
  });
  const selectionMatches = matching.some((item) => item.id === selectedId);
  useEffect(() => {
    if (previousSelection.current !== selectedId && selectedGroupId) {
      setExpanded((before) => ({ ...before, [selectedGroupId]: true }));
      setSearchCollapse({ query: "", groups: [] });
      if (!selectionMatches) {
        setSearch("");
      }
    }
    previousSelection.current = selectedId;
  }, [selectedId, selectedGroupId, selectionMatches]);
  return (
    <Surface className={styles.catalog} role="region" aria-label="위젯 목록">
      <div className={styles.title}>
        <strong>위젯 · {entries.length}개</strong>
        <Text variant="caption" tone="muted">
          설치 {installedCount}개
        </Text>
      </div>
      <TextField
        type="search"
        aria-label="위젯 검색"
        placeholder="위젯 검색"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className={styles.list}>
        {GROUPS.map(([id, label]) => {
          const items = matching.filter((item) => item.category === id);
          if (items.length === 0) {
            return null;
          }
          const collapsed = searchCollapse.query === query ? searchCollapse.groups : [];
          const open = isSearching ? !collapsed.includes(id) : expanded[id] === true;
          return (
            <section className={styles.group} key={id} aria-label={label}>
              <button
                type="button"
                className={styles.groupToggle}
                aria-label={`${label} ${items.length}개`}
                aria-expanded={open}
                aria-controls={`${prefix}-${id}`}
                onClick={() => {
                  if (isSearching) {
                    setSearchCollapse({
                      query,
                      groups: open ? [...collapsed, id] : collapsed.filter((value) => value !== id),
                    });
                  } else {
                    setExpanded((before) => ({ ...before, [id]: !open }));
                  }
                }}
              >
                <span aria-hidden="true">{open ? "⌄" : "›"}</span>
                <span>{label}</span>
                <span className={styles.count}>{items.length}</span>
              </button>
              <div id={`${prefix}-${id}`} hidden={!open}>
                {items.map((item) => (
                  <SelectableListRow
                    key={item.id}
                    selected={selectedId === item.id}
                    className={styles.entry}
                    aria-label={`${item.name} ${STATUS[item.status]}`}
                    aria-pressed={selectedId === item.id}
                    onClick={() => onSelect(item.id)}
                  >
                    <span className={styles.entryName}>{item.name}</span>
                    {(item.installed || item.attention) && (
                      <span className={styles.status} data-attention={item.attention}>
                        {STATUS[item.status]}
                      </span>
                    )}
                  </SelectableListRow>
                ))}
              </div>
            </section>
          );
        })}
        {matching.length === 0 && (
          <Text as="p" variant="caption" tone="muted" className={styles.empty}>
            찾는 위젯이 없어요. 검색어를 바꿔 보세요.
          </Text>
        )}
      </div>
      {children}
    </Surface>
  );
}
