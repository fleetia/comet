import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, FormField, Rule, Select, TextArea, TextField } from "@fleetia/lagrange";
import { command, errorText } from "../../hooks/useSnapshot";
import type { SceneLine, WordbookEntry } from "../../types";
import * as s from "../../lagrange.css";
import * as w from "./WordbookPanel.css";

type Draft = { entry: WordbookEntry; keywords: string; dirty: boolean; persisted: boolean };
const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];
function draftFor(entry: WordbookEntry, persisted = true): Draft {
  return { entry, keywords: entry.keywords.join(", "), dirty: false, persisted };
}
function newDraft(): Draft {
  return draftFor(
    {
      id: crypto.randomUUID(),
      title: "",
      keywords: [],
      lines: [{ persona: "a", expression: "평온", text: "" }],
      enabled: true,
      useForIdle: false,
    },
    false,
  );
}
function keywordsFrom(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，\n]+/u)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    ),
  ];
}
type Props = {
  title?: string;
  description?: string;
  entries: WordbookEntry[];
  saveEntry?: (entry: WordbookEntry) => Promise<void>;
  deleteEntry?: (id: string) => Promise<void>;
  singleCharacter?: boolean;
  speakerCount?: number;
  onDirtyChange?: (dirty: boolean) => void;
  initialEntryId?: string;
};
export function WordbookPanel({
  title = "단어장",
  description = "키워드가 포함되면 등록한 대사를 그대로 재생해요. 긴 키워드를 우선하고 길이가 같으면 먼저 등록한 항목을 사용해요.",
  entries,
  saveEntry,
  deleteEntry,
  singleCharacter = false,
  speakerCount = 8,
  onDirtyChange,
  initialEntryId,
}: Props): JSX.Element {
  const [initial] = useState(() => {
    const entry = entries.find((item) => item.id === initialEntryId) ?? entries[0];
    return entry ? draftFor(entry) : newDraft();
  });
  const [selected, setSelected] = useState(initial.entry.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({ [initial.entry.id]: initial });
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    setDrafts((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        if (!next[entry.id]?.dirty) {
          next[entry.id] = draftFor(entry);
        }
      }
      return next;
    });
  }, [entries]);
  const hasDirtyDraft = Object.values(drafts).some((draft) => draft.dirty);
  useEffect(() => {
    onDirtyChange?.(hasDirtyDraft);
  }, [hasDirtyDraft, onDirtyChange]);
  const current = drafts[selected] ?? initial;
  const list = [
    ...entries.map((entry) => drafts[entry.id] ?? draftFor(entry)),
    ...Object.values(drafts).filter(
      (draft) => !entries.some((entry) => entry.id === draft.entry.id),
    ),
  ].filter((draft) => !removed.includes(draft.entry.id));
  const keywords = keywordsFrom(current.keywords);
  const valid =
    Boolean(current.entry.title.trim()) &&
    keywords.length > 0 &&
    keywords.length <= 20 &&
    keywords.every((keyword) => keyword.length <= 80) &&
    current.entry.lines.every((line) => line.text.trim().length > 0);
  function update(entry: WordbookEntry, keywordText = current.keywords): void {
    setConfirmDelete(false);
    setDrafts((previous) => ({
      ...previous,
      [selected]: { ...current, entry, keywords: keywordText, dirty: true },
    }));
    setNotice(null);
  }
  function select(id: string): void {
    setConfirmDelete(false);
    setSelected(id);
    setError(null);
    setNotice(null);
  }
  function create(): void {
    const draft = newDraft();
    setDrafts((previous) => ({ ...previous, [draft.entry.id]: draft }));
    select(draft.entry.id);
  }
  function changeLine(index: number, line: SceneLine): void {
    update({
      ...current.entry,
      lines: current.entry.lines.map((value, position) => (position === index ? line : value)),
    });
  }
  function moveLine(index: number, offset: number): void {
    const lines = [...current.entry.lines];
    const [line] = lines.splice(index, 1);
    lines.splice(index + offset, 0, line);
    update({ ...current.entry, lines });
  }
  async function save(): Promise<void> {
    if (busy.current || !valid) {
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setConfirmDelete(false);
    const entry = { ...current.entry, title: current.entry.title.trim(), keywords };
    try {
      if (saveEntry) await saveEntry(entry);
      else await command("save_wordbook_entry", { entry });
      setDrafts((previous) => ({ ...previous, [entry.id]: draftFor(entry) }));
      setNotice("단어장에 저장했어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function remove(): Promise<void> {
    if (busy.current || !current.persisted) {
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const id = current.entry.id;
    try {
      if (deleteEntry) await deleteEntry(id);
      else await command("delete_wordbook_entry", { id });
      const fresh = newDraft();
      setRemoved((previous) => [...previous, id]);
      setDrafts((previous) => {
        const next = { ...previous, [fresh.entry.id]: fresh };
        delete next[id];
        return next;
      });
      setSelected(fresh.entry.id);
      setConfirmDelete(false);
      setNotice("단어장 항목을 지웠어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label={title}>
      <h2 className={s.sectionTitle}>{title}</h2>
      <p className={s.quiet}>{description}</p>
      {entries.length === 0 && (
        <p className={s.emptyHint}>
          등록한 항목이 없어요. 제목·키워드·대사를 입력해 첫 항목을 만들어 보세요.
        </p>
      )}
      <div className={w.layout}>
        <aside className={w.entries} aria-label="단어장 항목 목록">
          {list.map((draft) => (
            <Button
              key={draft.entry.id}
              type="button"
              variant="quiet"
              className={w.entry}
              aria-pressed={selected === draft.entry.id}
              disabled={pending}
              onClick={() => select(draft.entry.id)}
            >
              {draft.entry.title || "새 항목"}
              {draft.dirty ? " · 미저장" : ""}
              {!draft.entry.enabled ? " · 꺼짐" : ""}
            </Button>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={pending || list.length >= 100}
            onClick={create}
          >
            새 항목 만들기
          </Button>
        </aside>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className={w.editor} disabled={pending}>
            <legend className={w.legend}>단어장 항목 편집</legend>
            <FormField className={s.field} label="제목" required>
              <TextField
                maxLength={80}
                value={current.entry.title}
                onChange={(event) => update({ ...current.entry, title: event.target.value })}
              />
            </FormField>
            <FormField className={s.field} label="키워드" required>
              <TextArea
                placeholder="안녕, 반가워"
                value={current.keywords}
                onChange={(event) => update(current.entry, event.target.value)}
              />
            </FormField>
            <p className={s.quiet}>
              쉼표나 줄바꿈으로 나눠요. 키워드는 20개까지, 하나당 80자까지 입력할 수 있어요.
            </p>
            <div className={s.row}>
              <Checkbox
                disabled={pending}
                checked={current.entry.enabled}
                onChange={(event) => update({ ...current.entry, enabled: event.target.checked })}
              >
                이 항목 사용
              </Checkbox>
              <Checkbox
                disabled={pending}
                checked={current.entry.useForIdle}
                onChange={(event) => update({ ...current.entry, useForIdle: event.target.checked })}
              >
                자동 잡담에도 사용
              </Checkbox>
            </div>
            {current.entry.lines.map((line, index) => (
              <div key={index} className={w.line}>
                <div className={s.row}>
                  <label className={s.inline}>
                    {index + 1}번 화자
                    <Select
                      aria-label={`${index + 1}번 화자`}
                      value={line.persona}
                      onChange={(event) =>
                        changeLine(index, {
                          ...line,
                          persona: event.target.value,
                        })
                      }
                    >
                      {Array.from({ length: singleCharacter ? 1 : speakerCount }, (_, index) => (
                        <option key={index} value={String.fromCharCode(97 + index)}>
                          {singleCharacter ? "이 캐릭터" : String.fromCharCode(65 + index)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className={s.inline}>
                    표정
                    <Select
                      aria-label={`${index + 1}번 표정`}
                      value={line.expression}
                      onChange={(event) =>
                        changeLine(index, { ...line, expression: event.target.value })
                      }
                    >
                      {EXPRESSIONS.map((expression) => (
                        <option key={expression} value={expression}>
                          {expression}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`${index + 1}번 대사 위로`}
                    disabled={index === 0}
                    onClick={() => moveLine(index, -1)}
                  >
                    위로
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`${index + 1}번 대사 아래로`}
                    disabled={index === current.entry.lines.length - 1}
                    onClick={() => moveLine(index, 1)}
                  >
                    아래로
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`${index + 1}번 대사 삭제`}
                    disabled={current.entry.lines.length === 1}
                    onClick={() =>
                      update({
                        ...current.entry,
                        lines: current.entry.lines.filter((_, position) => position !== index),
                      })
                    }
                  >
                    삭제
                  </Button>
                </div>
                <TextArea
                  aria-label={`대사 ${index + 1}`}
                  required
                  maxLength={500}
                  value={line.text}
                  onChange={(event) => changeLine(index, { ...line, text: event.target.value })}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={current.entry.lines.length >= 8}
              onClick={() =>
                update({
                  ...current.entry,
                  lines: [
                    ...current.entry.lines,
                    {
                      persona:
                        !singleCharacter && current.entry.lines.at(-1)?.persona === "a" ? "b" : "a",
                      expression: "평온",
                      text: "",
                    },
                  ],
                })
              }
            >
              대사 추가
            </Button>
            <div className={w.saveBar}>
              <Rule variant="structural" />
              <div className={w.actions}>
                <Button type="submit" variant="primary" disabled={!valid || !current.dirty}>
                  {pending ? "처리 중…" : "단어장 저장"}
                </Button>
                {current.persisted && (
                  <Button type="button" variant="quiet" onClick={() => setConfirmDelete(true)}>
                    항목 삭제
                  </Button>
                )}
                <span className={s.quiet} role="status">
                  {!valid
                    ? "제목·키워드·대사를 채워 주세요. 키워드는 20개까지, 하나당 80자까지예요."
                    : current.dirty
                      ? "이 항목에 저장하지 않은 변경이 있어요."
                      : "저장된 항목이에요."}
                </span>
              </div>
              {confirmDelete && (
                <div className={w.confirmation} aria-label="삭제 확인">
                  <p>‘{current.entry.title}’ 항목을 삭제할까요? 삭제한 대사는 되돌릴 수 없어요.</p>
                  <div className={w.actions}>
                    <Button type="button" variant="secondary" onClick={() => void remove()}>
                      항목 삭제 확인
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => setConfirmDelete(false)}>
                      삭제 취소
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </fieldset>
        </form>
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={s.success}>
          {notice}
        </p>
      )}
    </section>
  );
}
