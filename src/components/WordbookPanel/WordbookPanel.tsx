import { useEffect, useRef, useState, type JSX } from "react";
import {
  Button,
  Checkbox,
  FormField,
  Select,
  SelectableListRow,
  Surface,
  TextArea,
  TextField,
} from "@fleetia/lagrange";
import { command, errorText } from "../../hooks/useSnapshot";
import type {
  InstalledCharacter,
  SceneLine,
  WordbookEntry,
  WordbookGroup,
  WordbookMatchPreview,
} from "../../types";
import { MotionSelect, motionError, motionOwner } from "../MotionSelect/MotionSelect";
import * as s from "../../lagrange.css";
import * as w from "./WordbookPanel.css";

type Draft = {
  entry: WordbookEntry;
  keywords: string;
  dirty: boolean;
  persisted: boolean;
  baseline: WordbookEntry;
};
const GROUPS: { value: WordbookGroup; label: string }[] = [
  { value: "work", label: "업무" },
  { value: "rest", label: "휴식" },
  { value: "daily", label: "일상" },
];
function groupLabel(group?: WordbookGroup): string {
  return GROUPS.find((option) => option.value === group)?.label ?? "미분류";
}
function PreviewLines({
  lines,
  owners,
}: {
  lines: SceneLine[];
  owners: (InstalledCharacter | undefined)[];
}): JSX.Element {
  return (
    <ol className={w.previewLines}>
      {lines.map((line, index) => (
        <li key={index}>
          <strong>
            {motionOwner(line.persona, owners)?.definition.name ?? line.persona.toUpperCase()}
          </strong>
          <span className={w.previewText}>{line.text || "대사를 입력해 주세요."}</span>
        </li>
      ))}
    </ol>
  );
}
const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];
function draftFor(entry: WordbookEntry, persisted = true): Draft {
  return { entry, keywords: entry.keywords.join(", "), dirty: false, persisted, baseline: entry };
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
function draftKeywords(draft: Draft): string[] {
  return draft.keywords === draft.entry.keywords.join(", ")
    ? draft.entry.keywords
    : keywordsFrom(draft.keywords);
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
  owners?: (InstalledCharacter | undefined)[];
  highlight?: boolean;
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
  owners = [],
  highlight = true,
}: Props): JSX.Element {
  const [initial] = useState(() => {
    const entry = entries.find((item) => item.id === initialEntryId) ?? entries[0];
    return entry ? draftFor(entry) : newDraft();
  });
  const [selected, setSelected] = useState(initial.entry.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({ [initial.entry.id]: initial });
  const [removed, setRemoved] = useState<string[]>([]);
  // Confirmed local saves bridge only the gap until the next authoritative snapshot.
  const [localSaves, setLocalSaves] = useState<{
    snapshot: WordbookEntry[];
    entries: WordbookEntry[];
  } | null>(null);
  const latestEntries = useRef(entries);
  latestEntries.current = entries;
  const [pending, setPending] = useState(false);
  const [groupFilter, setGroupFilter] = useState<"all" | "ungrouped" | WordbookGroup>("all");
  const [testInput, setTestInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    context: string;
    match: WordbookMatchPreview | null;
  } | null>(null);
  const testRequest = useRef(0);
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
        } else {
          next[entry.id] = { ...next[entry.id], baseline: entry };
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
  const filteredList = list.filter((draft) =>
    groupFilter === "all"
      ? true
      : groupFilter === "ungrouped"
        ? !draft.entry.group
        : draft.entry.group === groupFilter,
  );
  // Retained drafts may belong to externally deleted entries. Only the current snapshot
  // and confirmed saves awaiting its next update are authoritative for matching.
  const awaitingSnapshot = localSaves?.snapshot === entries ? localSaves.entries : [];
  const savedEntries = [
    ...entries.map((entry) => awaitingSnapshot.find((saved) => saved.id === entry.id) ?? entry),
    ...awaitingSnapshot.filter((saved) => !entries.some((entry) => entry.id === saved.id)),
  ].filter((entry) => !removed.includes(entry.id));
  const testContext = JSON.stringify({ input: testInput, entries: savedEntries });
  const latestTestContext = useRef(testContext);
  latestTestContext.current = testContext;
  useEffect(() => {
    testRequest.current += 1;
    setTesting(false);
    setTestError(null);
    setTestResult(null);
    return () => {
      testRequest.current += 1;
    };
  }, [testContext]);
  const keywords = draftKeywords(current);
  const duplicateEntries = list.filter(
    (draft) =>
      draft.entry.id !== current.entry.id &&
      draftKeywords(draft).some((keyword) =>
        keywords.some((currentKeyword) => currentKeyword.toLowerCase() === keyword.toLowerCase()),
      ),
  );
  const valid =
    Boolean(current.entry.title.trim()) &&
    keywords.length > 0 &&
    keywords.length <= 20 &&
    keywords.every((keyword) => keyword.length <= 80) &&
    current.entry.lines.every(
      (line) =>
        line.text.trim().length > 0 &&
        !motionError(
          line.motion,
          motionOwner(line.persona, owners)?.definition.animation?.clips ?? [],
        ),
    );
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
    if (groupFilter !== "all" && groupFilter !== "ungrouped") {
      draft.entry.group = groupFilter;
    }
    setDrafts((previous) => ({ ...previous, [draft.entry.id]: draft }));
    select(draft.entry.id);
  }
  function cancel(): void {
    if (pending) return;
    setConfirmDelete(false);
    setNotice(null);
    setError(null);
    if (current.persisted) {
      setDrafts((previous) => ({ ...previous, [selected]: draftFor(current.baseline) }));
      return;
    }
    const next = list.find((draft) => draft.entry.id !== selected);
    const fresh = next ?? newDraft();
    setDrafts((previous) => {
      const values = { ...previous, [fresh.entry.id]: fresh };
      delete values[selected];
      return values;
    });
    select(fresh.entry.id);
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
    const entry = {
      ...current.entry,
      title:
        current.entry.title === current.baseline.title
          ? current.entry.title
          : current.entry.title.trim(),
      keywords,
    };
    const snapshot = latestEntries.current;
    try {
      if (saveEntry) await saveEntry(entry);
      else await command("save_wordbook_entry", { entry });
      // A snapshot received during this request is authoritative, even if the save
      // response arrives later. Never bridge a stale completion over that snapshot.
      if (latestEntries.current === snapshot) {
        setLocalSaves((previous) => {
          const saved = previous?.snapshot === snapshot ? previous.entries : [];
          return {
            snapshot,
            entries: saved.some((value) => value.id === entry.id)
              ? saved.map((value) => (value.id === entry.id ? entry : value))
              : [...saved, entry],
          };
        });
      }
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
  async function testMatch(): Promise<void> {
    if (testing || !testInput.trim()) return;
    const request = ++testRequest.current;
    const context = testContext;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const match = await command<WordbookMatchPreview | null>("preview_wordbook_match", {
        entries: savedEntries,
        input: testInput,
      });
      if (request === testRequest.current && context === latestTestContext.current) {
        setTestResult({ context, match });
      }
    } catch (cause) {
      if (request === testRequest.current && context === latestTestContext.current) {
        setTestError(errorText(cause));
      }
    } finally {
      if (request === testRequest.current) setTesting(false);
    }
  }
  return (
    <section className={w.workspace} aria-label={title}>
      <div className={w.layout}>
        <Surface className={w.entries} padding="flush" aria-label="단어장 항목 목록">
          <div className={w.listBody}>
            <h2 className={w.sectionTitle}>{highlight ? "내 단어장" : title}</h2>
            <p className={s.quiet}>
              {highlight ? "개인 항목 · 캐릭터를 바꿔도 유지" : description}
            </p>
            <FormField label="분류로 찾기">
              <Select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value as typeof groupFilter)}
              >
                <option value="all">전체 · {list.length}개</option>
                <option value="ungrouped">미분류</option>
                {GROUPS.map((group) => (
                  <option key={group.value} value={group.value}>
                    {group.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <p className={s.quiet}>분류는 목록 정리용이에요. 재생 조건은 바뀌지 않아요.</p>
            {filteredList.length === 0 && <p className={s.quiet}>이 분류에 항목이 없어요.</p>}
            {!filteredList.some((draft) => draft.entry.id === selected) && (
              <p className={s.quiet}>현재 편집 중인 항목은 다른 분류에 있어요. 초안은 유지돼요.</p>
            )}
            {filteredList.map((draft) => (
              <SelectableListRow
                key={draft.entry.id}
                type="button"
                className={w.entry}
                selected={selected === draft.entry.id}
                aria-label={`${draft.entry.title || "새 항목"}${draft.dirty ? " · 미저장" : ""}${!draft.entry.enabled ? " · 꺼짐" : ""}`}
                disabled={pending}
                onClick={() => select(draft.entry.id)}
              >
                <span>
                  {draft.entry.title || "새 항목"}
                  {draft.dirty ? " · 미저장" : ""}
                  {!draft.entry.enabled ? " · 꺼짐" : ""}
                </span>
                <span className={w.entryKeywords}>
                  {groupLabel(draft.entry.group)} ·{" "}
                  {draft.entry.keywords.join(", ") || "키워드 없음"} · {draft.entry.lines.length}줄
                </span>
              </SelectableListRow>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={pending || list.length >= 100}
              onClick={create}
            >
              새 항목 만들기
            </Button>
          </div>
        </Surface>
        <Surface className={w.form} padding="flush">
          <form
            className={w.editorForm}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset className={w.editor} disabled={pending}>
              <legend className={w.legend}>단어장 항목 편집</legend>
              <div className={w.editorBody}>
                {highlight && (
                  <Surface tone="accent" padding="inline" className={w.heading}>
                    <strong>{current.entry.title || "새 항목"}</strong>
                    <span>{current.entry.lines.length} / 8줄</span>
                  </Surface>
                )}
                <details className={w.previewDetails} open={!highlight || undefined}>
                  <summary>대사 미리보기 · 현재 편집 내용</summary>
                  <p className={s.quiet}>
                    공백·줄바꿈·화자 순서를 그대로 확인해요. 실제로 재생하지 않아요.
                  </p>
                  <Surface tone="accent" className={w.preview} aria-label="키워드 대사 미리보기">
                    <PreviewLines lines={current.entry.lines} owners={owners} />
                  </Surface>
                </details>
                <section className={w.matchTest} aria-label="저장된 키워드 테스트">
                  <strong>입력으로 매칭 확인</strong>
                  <p className={s.quiet}>
                    이 목록의 저장된 모든 항목에서 찾아요. 분류 필터와 미저장 수정은 적용하지
                    않아요. 대소문자를 구분하지 않고 긴 키워드, 같은 길이면 먼저 등록한 항목을
                    선택해요.
                  </p>
                  <div className={w.testControls}>
                    <FormField label="테스트할 말">
                      <TextField
                        value={testInput}
                        maxLength={2000}
                        placeholder="예: 안녕, 오늘도 반가워"
                        onChange={(event) => setTestInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            void testMatch();
                          }
                        }}
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={testing || !testInput.trim()}
                      onClick={() => void testMatch()}
                    >
                      {testing ? "확인 중…" : "매칭 테스트"}
                    </Button>
                  </div>
                  <p className={s.quiet}>
                    대사 재생·대화 전송·AI 호출은 하지 않아요. 실제 대화 상대와 화자에 따른 재생
                    가능 여부는 별도로 확인해 주세요.
                  </p>
                  {testError && (
                    <p role="alert" className={s.error}>
                      {testError}
                    </p>
                  )}
                  {testResult?.context === testContext && (
                    <div role="status" aria-label="매칭 결과">
                      {testResult.match ? (
                        <>
                          <p>
                            일치한 등록 항목: <strong>{testResult.match.entry.title}</strong> ·
                            키워드 ‘{testResult.match.keyword}’
                          </p>
                          <Surface
                            tone="accent"
                            className={w.preview}
                            aria-label="일치한 등록 대사"
                          >
                            <PreviewLines lines={testResult.match.entry.lines} owners={owners} />
                          </Surface>
                        </>
                      ) : (
                        <p>일치하는 저장된 활성 항목이 없어요.</p>
                      )}
                    </div>
                  )}
                </section>
                <div className={w.fields}>
                  <FormField label="제목" required>
                    <TextField
                      maxLength={80}
                      value={current.entry.title}
                      onChange={(event) => update({ ...current.entry, title: event.target.value })}
                    />
                  </FormField>
                  <FormField label="키워드" required>
                    <TextArea
                      className={w.keywordsInput}
                      rows={1}
                      placeholder="안녕, 반가워"
                      value={current.keywords}
                      onChange={(event) => update(current.entry, event.target.value)}
                    />
                  </FormField>
                </div>
                <p className={s.quiet}>
                  쉼표나 줄바꿈으로 나눠요. 키워드는 20개까지, 하나당 80자까지 입력할 수 있어요.
                </p>
                {duplicateEntries.length > 0 && (
                  <p role="note" className={w.warning}>
                    같은 키워드가 다른 항목에도 있어요:{" "}
                    {duplicateEntries
                      .map(
                        (draft) =>
                          `‘${draft.entry.title || "새 항목"}’${draft.entry.enabled ? "" : " (꺼짐)"}${draft.dirty ? " (미저장)" : ""}`,
                      )
                      .join(", ")}
                    . 저장된 활성 항목 중 긴 일치 키워드가 우선이고, 길이가 같으면 먼저 등록한
                    항목을 사용해요. 저장 전에는 위 매칭 테스트에 반영되지 않아요.
                  </p>
                )}
                <FormField label="분류 (선택)" className={w.groupField}>
                  <Select
                    value={current.entry.group ?? ""}
                    onChange={(event) =>
                      update({
                        ...current.entry,
                        group: (event.target.value || undefined) as WordbookGroup | undefined,
                      })
                    }
                  >
                    <option value="">미분류</option>
                    {GROUPS.map((group) => (
                      <option key={group.value} value={group.value}>
                        {group.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <p className={s.quiet}>
                  업무·휴식·일상은 정리용 이름이며, 현재 상태에 따라 재생을 제한하지 않아요.
                </p>
                <div className={s.row}>
                  <Checkbox
                    disabled={pending}
                    checked={current.entry.enabled}
                    onChange={(event) =>
                      update({ ...current.entry, enabled: event.target.checked })
                    }
                  >
                    이 항목 사용
                  </Checkbox>
                  <Checkbox
                    disabled={pending}
                    checked={current.entry.useForIdle}
                    onChange={(event) =>
                      update({ ...current.entry, useForIdle: event.target.checked })
                    }
                  >
                    자동 잡담에도 사용
                  </Checkbox>
                </div>
                <div className={w.lineHeading}>
                  <strong>대사 순서</strong>
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
                              !singleCharacter && current.entry.lines.at(-1)?.persona === "a"
                                ? "b"
                                : "a",
                            expression: "평온",
                            text: "",
                          },
                        ],
                      })
                    }
                  >
                    대사 추가
                  </Button>
                </div>
                {current.entry.lines.map((line, index) => (
                  <div key={index} className={w.line}>
                    <div className={w.lineControls}>
                      <span className={w.lineNumber}>{String(index + 1).padStart(2, "0")}</span>
                      <label className={s.inline}>
                        <span className={w.legend}>{index + 1}번 화자</span>
                        <Select
                          aria-label={`${index + 1}번 화자`}
                          value={line.persona}
                          onChange={(event) =>
                            changeLine(index, {
                              ...line,
                              persona: event.target.value,
                              motion: line.motion?.mode === "clip" ? undefined : line.motion,
                            })
                          }
                        >
                          {Array.from(
                            { length: singleCharacter ? 1 : speakerCount },
                            (_, index) => (
                              <option key={index} value={String.fromCharCode(97 + index)}>
                                {singleCharacter
                                  ? "이 캐릭터"
                                  : `${String.fromCharCode(65 + index)}${owners[index] ? ` · ${owners[index]?.definition.name}` : ""}`}
                              </option>
                            ),
                          )}
                        </Select>
                      </label>
                      <label className={s.inline}>
                        <span className={w.legend}>표정</span>
                        <Select
                          aria-label={`${index + 1}번 표정`}
                          value={line.expression}
                          onChange={(event) =>
                            changeLine(index, { ...line, expression: event.target.value })
                          }
                        >
                          {[
                            ...new Set([
                              ...Object.keys(
                                motionOwner(line.persona, owners)?.definition.expressions ??
                                  Object.fromEntries(
                                    EXPRESSIONS.map((expression) => [expression, expression]),
                                  ),
                              ),
                              line.expression,
                            ]),
                          ].map((expression) => (
                            <option key={expression} value={expression}>
                              {expression}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <div className={w.motion}>
                        <MotionSelect
                          label={`${index + 1}번 대사`}
                          value={line.motion}
                          clips={
                            motionOwner(line.persona, owners)?.definition.animation?.clips ?? []
                          }
                          onChange={(motion) => changeLine(index, { ...line, motion })}
                        />
                      </div>
                      <span className={w.lineLimit}>500자까지</span>
                      <Button
                        type="button"
                        variant="quiet"
                        size="compact"
                        aria-label={`${index + 1}번 대사 위로`}
                        disabled={index === 0}
                        onClick={() => moveLine(index, -1)}
                      >
                        위로
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        size="compact"
                        aria-label={`${index + 1}번 대사 아래로`}
                        disabled={index === current.entry.lines.length - 1}
                        onClick={() => moveLine(index, 1)}
                      >
                        아래로
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        size="compact"
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
                      className={w.lineText}
                      rows={3}
                      required
                      maxLength={500}
                      value={line.text}
                      onChange={(event) => changeLine(index, { ...line, text: event.target.value })}
                    />
                  </div>
                ))}
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
              <div className={w.saveBar}>
                <div className={w.actions}>
                  <span className={w.saveStatus} role="status">
                    {!valid
                      ? "제목·키워드·대사를 채워 주세요."
                      : current.dirty
                        ? "이 항목 변경사항 있음"
                        : "저장된 항목"}
                  </span>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={pending || (!current.dirty && current.persisted)}
                    onClick={cancel}
                  >
                    수정 취소
                  </Button>
                  <Button type="submit" variant="primary" disabled={!valid || !current.dirty}>
                    {pending ? "처리 중…" : "단어장 저장"}
                  </Button>
                  {current.persisted && (
                    <Button type="button" variant="quiet" onClick={() => setConfirmDelete(true)}>
                      항목 삭제
                    </Button>
                  )}
                </div>
                {confirmDelete && (
                  <div className={w.confirmation} aria-label="삭제 확인">
                    <p>
                      ‘{current.entry.title}’ 항목을 삭제할까요? 삭제한 대사는 되돌릴 수 없어요.
                    </p>
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
        </Surface>
      </div>
    </section>
  );
}
