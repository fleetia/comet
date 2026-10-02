import catalog from "../../../widgets/catalog.json";
import type { CharacterCollection, Snapshot } from "../../types";
import type { WidgetSnapshot, WidgetView } from "../../widgets/types";
import { offeredForInstall } from "../../widgets/toolData";
import { SETTINGS_SECTIONS, type SettingsSection } from "../SettingsPanel/useSettingsNavigation";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export type LauncherState = {
  sessionId: number;
  shortcut: string;
  shortcutRegistered: boolean;
  shortcutError: string | null;
};
export type LauncherAction =
  | { type: "settings"; section: SettingsSection | null }
  | { type: "widget"; id: string; expectedRevision: number }
  | { type: "chat"; content: string; target: string; clientMessageId: string }
  | { type: "addTodo"; id: string; expectedRevision: number; title: string; requestId: string };
export type TargetBinding = { token: string; id: string; name: string };
export type LauncherResult = {
  id: string;
  title: string;
  detail: string;
  preview: string;
  kind: "settings" | "widget" | "chat" | "target" | "notice" | "todo";
  action?:
    | Exclude<LauncherAction, { type: "chat" } | { type: "addTodo" }>
    | Omit<Extract<LauncherAction, { type: "chat" }>, "clientMessageId">
    | Omit<Extract<LauncherAction, { type: "addTodo" }>, "requestId">;
  recipient?: TargetBinding;
};

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, "").trim();
}
function score(query: string, aliases: string[]): number {
  const normalized = normalize(query);
  if (aliases.some((alias) => normalize(alias) === normalized)) return 0;
  if (aliases.some((alias) => normalize(alias).startsWith(normalized))) return 1;
  return -1;
}
export function activeTargets(characters: CharacterCollection): TargetBinding[] {
  return characters.active.flatMap((id, index) => {
    const character = characters.installed.find((candidate) => candidate.id === id);
    return character
      ? [{ token: String.fromCharCode(65 + index), id, name: character.definition.name }]
      : [];
  });
}
export function bindTarget(
  query: string,
  characters: CharacterCollection,
  previous: TargetBinding | null,
): TargetBinding | null {
  const match = /^>(\S+)\s/.exec(query.trimStart());
  if (!match) return null;
  const token = normalize(match[1]);
  if (previous && normalize(previous.token) === token) return previous;
  const targets = activeTargets(characters);
  const slot = targets.find((candidate) => normalize(candidate.token) === token);
  if (slot) return { ...slot, token: match[1] };
  const named = targets.filter((candidate) => normalize(candidate.name) === token);
  return named.length === 1 ? { ...named[0], token: match[1] } : null;
}
function chatResult(content: string, snapshot: Snapshot, target?: TargetBinding): LauncherResult {
  const names = activeTargets(snapshot.characters).map((candidate) => candidate.name);
  const recipient = target ? `${target.name}에게만` : `모두에게 · ${names.length}명`;
  return {
    id: `chat:${target?.id ?? "all"}`,
    title: `${recipient} 말 걸기`,
    detail: snapshot.runtime.hidden
      ? "캐릭터 표시 후 말 걸기"
      : target
        ? `받는 친구: ${target.name}`
        : names.join(" · "),
    preview: content,
    kind: "chat",
    action:
      content && [...content].length <= 2000
        ? { type: "chat", content, target: target?.id ?? "all" }
        : undefined,
  };
}
function targetResults(snapshot: Snapshot, token: string): LauncherResult[] {
  const targets = activeTargets(snapshot.characters).filter(
    (candidate) => !token || score(token, [candidate.token, candidate.name]) >= 0,
  );
  const results: LauncherResult[] = targets.map((target) => ({
    id: `target:${target.id}`,
    title: `${target.token} · ${target.name}`,
    detail: "이 친구에게만 말 걸기",
    preview: `${target.name}을 선택한 다음 하고 싶은 말을 적어 주세요.`,
    kind: "target",
    recipient: target,
  }));
  if (!token)
    results.unshift({
      id: "target:all",
      title: `모두에게 · ${targets.length}명`,
      detail: "함께 지내는 친구 모두에게",
      preview: "친구들이 현재 순서대로 답해요.",
      kind: "target",
    });
  return results;
}
const WIDGET_ALIASES: Record<string, string[]> = {
  todo: ["투두", "오늘", "할일", "플래너"],
  calendar: ["일정", "달력"],
  ball: ["공 던지기", "공 꺼내기"],
  "paper-plane": ["비행기", "비행기 날리기", "종이비행기 날리기"],
  bubbles: ["방울", "방울 만들기"],
  pet: ["펫", "펫 꺼내기"],
  clock: ["시계", "기념일", "디데이"],
  device: ["배터리"],
  "focus-timer": ["타이머", "집중"],
  "small-match": ["주사위", "가위바위보", "동전"],
  music: ["음악"],
  collection: ["수집함", "소품"],
};
const SECTION_ALIASES: Partial<Record<SettingsSection, string[]>> = {
  model: ["모델", "API", "AI", "인공지능"],
  wordbook: ["단어장"],
  automatic: ["자동 수다"],
  characters: ["캐릭터 관리", "친구"],
  widgets: ["위젯 관리"],
  general: ["업데이트"],
};
function widgetResult(
  entry: { id: string; name: string; description: string },
  instance: WidgetView | undefined,
): LauncherResult {
  const needsSetup = instance?.installed && instance.enabled && instance.status === "setup";
  const available = instance?.installed && instance.enabled && !needsSetup;
  const toy = ["ball", "paper-plane", "bubbles"].includes(entry.id);
  return {
    id: `widget:${entry.id}`,
    title: available
      ? `${entry.name} ${toy ? "꺼내기" : "열기"}`
      : needsSetup
        ? `${entry.name} 설정 열기`
        : `${entry.name} ${instance?.installed ? "켜기" : "설치"} 설정 열기`,
    detail: available ? (toy ? "바탕화면 장난감" : "위젯") : "설정 › 위젯",
    preview: available
      ? toy
        ? `${entry.name}을 바탕화면에 꺼내요. 우클릭으로 정리할 수 있어요.`
        : entry.description
      : needsSetup
        ? `${entry.name} 사용 준비가 필요해요. 위젯 설정에서 연결과 설정을 확인해요.`
        : `${entry.name}을 사용할 수 있도록 위젯 설정으로 이동해요. 자동으로 설치하거나 켜지 않아요.`,
    kind: "widget",
    action: available
      ? { type: "widget", id: instance.id, expectedRevision: instance.revision }
      : { type: "settings", section: "widgets" },
  };
}
/** Saves the whole input, as typed, to the undated inbox only when this row is chosen. */
function todoResult(
  title: string,
  widgets: WidgetSnapshot | null,
  shown: LauncherResult[],
): LauncherResult | null {
  if (!widgets) return null;
  const instance = widgets.widgets.find((candidate) => candidate.kind === "todo");
  if (!instance?.installed || !instance.enabled) {
    const entry = widgets.catalog.find((candidate) => candidate.id === "todo");
    return entry && !shown.some((result) => result.id === "widget:todo")
      ? widgetResult(entry, instance)
      : null;
  }
  const fits = [...title].length <= 500;
  return {
    id: "todo:inbox",
    title: "할 일로 적기",
    detail: fits ? "할 일 › 수집함(날짜 없음)" : "할 일은 500자 이하로 적어 주세요",
    preview: `입력한 문장을 그대로 날짜 없는 할 일로 저장해요. ${title}`,
    kind: "todo",
    action: fits
      ? { type: "addTodo", id: instance.id, expectedRevision: instance.revision, title }
      : undefined,
  };
}
export function launcherResults(
  query: string,
  snapshot: Snapshot,
  widgets: WidgetSnapshot | null,
  binding: TargetBinding | null,
): LauncherResult[] {
  const input = query.trimStart();
  if (input.startsWith(">")) {
    const rest = input.slice(1);
    if (!rest || (!/\s/.test(rest) && !binding)) {
      const results = targetResults(snapshot, rest);
      return results.length
        ? results
        : [
            {
              id: "missing-target",
              title: "함께 지내는 친구를 찾지 못했어요",
              detail: ">를 입력하면 친구 목록을 볼 수 있어요.",
              preview: "대상을 확인하기 전에는 보내지 않아요.",
              kind: "notice",
            },
          ];
    }
    if (/^\s/.test(rest)) return [chatResult(rest.trim(), snapshot)];
    const token = /^\S+/.exec(rest)?.[0] ?? "";
    if (
      !binding ||
      normalize(binding.token) !== normalize(token) ||
      !snapshot.characters.active.includes(binding.id)
    ) {
      return [
        {
          id: "missing-target",
          title: "대화 상대를 다시 선택해 주세요",
          detail: "친구가 없거나 이름이 겹쳐요. >로 목록을 열어 주세요.",
          preview: "모두에게 대신 보내지 않아요.",
          kind: "notice",
        },
      ];
    }
    return [chatResult(rest.slice(token.length).trim(), snapshot, binding)];
  }
  const normalized = query.trim();
  const candidates: { result: LauncherResult; rank: number }[] = [];
  const settings: LauncherResult = {
    id: "settings",
    title: "설정 열기",
    detail: "마지막으로 보던 설정",
    preview: "설정창을 열어요. 작성 중인 설정은 그대로 유지돼요.",
    kind: "settings",
    action: { type: "settings", section: null },
  };
  const settingsRank = score(normalized, ["설정", "설정 열기", "settings"]);
  if (!normalized || settingsRank >= 0) candidates.push({ result: settings, rank: settingsRank });
  for (const section of SETTINGS_SECTIONS) {
    const rank = score(normalized, [section.label, ...(SECTION_ALIASES[section.id] ?? [])]);
    if ((!normalized && section.id === "widgets") || (normalized && rank >= 0))
      candidates.push({
        rank,
        result: {
          id: `settings:${section.id}`,
          title: `${section.label} 설정`,
          detail: `설정 › ${section.label}`,
          preview: `${section.label} 영역으로 이동해요. 다른 영역의 미저장 내용은 유지돼요.`,
          kind: "settings",
          action: { type: "settings", section: section.id },
        },
      });
  }
  for (const entry of widgets?.catalog ?? catalog) {
    const rank = score(normalized, [
      entry.name,
      entry.id,
      ...(WIDGET_ALIASES[entry.id] ?? []),
      `${entry.name} 열기`,
    ]);
    if (normalized ? rank < 0 : !["todo", "ball", "memo"].includes(entry.id)) continue;
    if (!widgets) {
      candidates.push({
        rank,
        result: {
          id: `widget:${entry.id}`,
          title: `${entry.name} 상태 확인 중`,
          detail: "위젯을 읽은 뒤 실행할 수 있어요",
          preview: "알려진 위젯이에요. 상태를 확인하기 전에는 실행하거나 대화로 보내지 않아요.",
          kind: "notice",
        },
      });
      continue;
    }
    const instance = widgets.widgets.find((candidate) => candidate.kind === entry.id);
    if (!offeredForInstall(entry.id, instance)) continue;
    candidates.push({ rank, result: widgetResult(entry, instance) });
  }
  const results = candidates
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map(({ result }) => result);
  if (normalized) {
    results.push(chatResult(normalized, snapshot));
    // Last row, so Enter keeps sending the sentence as conversation.
    const todo = todoResult(normalized, widgets, results);
    if (todo) results.push(todo);
  } else
    results.push({
      id: "target:all",
      title: "친구에게 말 걸기",
      detail: ">를 입력하면 친구를 고를 수 있어요",
      preview: "모두에게 또는 한 친구에게 말을 걸어요.",
      kind: "target",
    });
  return results;
}
export function shortcutLabel(shortcut: string): string {
  return shortcut
    .replace(/CommandOrControl/g, "⌘ / Ctrl")
    .replace(/Super|Meta|Command/g, "⌘")
    .replace(/Control/g, "Ctrl")
    .replace(/Alt/g, "⌥ / Alt")
    .replace(/Shift/g, "⇧")
    .replace(/Key([A-Z])/g, "$1")
    .replace(/Digit(\d)/g, "$1")
    .replace(/\+/g, " + ");
}
