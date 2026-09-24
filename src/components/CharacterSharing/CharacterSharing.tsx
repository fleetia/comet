import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, Dialog, Select, TextField } from "@fleetia/lagrange";
import { command, errorText } from "../../hooks/useSnapshot";
import type {
  CharacterExportOptions,
  CharacterPack,
  InstalledCharacter,
  Snapshot,
} from "../../types";
import { CharacterPackPreview } from "../CharacterPackPreview/CharacterPackPreview";
import * as ui from "../../lagrange.css";
import * as s from "../characters.css";

export type SharingAction = "import" | "export" | "attribution";
type Attribution = { author: string; sourceUrl: string };
type AttributionDraft = { saved: Attribution; draft: Attribution };

type Props = {
  snapshot: Snapshot;
  selectedId: string | null;
  disabled: boolean;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  action?: SharingAction | null;
  onActionChange?: (action: SharingAction | null) => void;
  contentDirty?: boolean;
  exportScope?: "selected" | "pair";
};
export function CharacterSharing({
  snapshot,
  selectedId,
  disabled,
  onPendingChange,
  onDirtyChange,
  action,
  onActionChange,
  contentDirty = false,
  exportScope,
}: Props): JSX.Element {
  const [scope, setScope] = useState("selected");
  const [options, setOptions] = useState<CharacterExportOptions>({
    includeSprites: true,
    includeMemories: false,
    includeAffinity: false,
    includeMessages: false,
  });
  useEffect(() => {
    if (action === "export") {
      setOptions({
        includeSprites: true,
        includeMemories: false,
        includeAffinity: false,
        includeMessages: false,
      });
    }
  }, [action, selectedId]);
  const [attributions, setAttributions] = useState<Record<string, AttributionDraft>>({});
  const [wordbookIds, setWordbookIds] = useState<string[]>([]);
  const [pack, setPack] = useState<CharacterPack | null>(null);
  const [installed, setInstalled] = useState<InstalledCharacter[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const { active } = snapshot.characters;
  const packId = snapshot.characters.installed.find((item) => item.id === selectedId)?.packId;
  const attribution = packId ? attributions[packId] : undefined;
  const author = attribution?.draft.author ?? "";
  const sourceUrl = attribution?.draft.sourceUrl ?? "";
  const attributionLoaded = Boolean(attribution);
  const attributionDirty = Object.values(attributions).some(
    ({ saved, draft }) => saved.author !== draft.author || saved.sourceUrl !== draft.sourceUrl,
  );
  const currentAttributionDirty =
    attribution &&
    (attribution.saved.author !== author || attribution.saved.sourceUrl !== sourceUrl);
  const [attributionRevision, setAttributionRevision] = useState(0);
  function changeAttribution(patch: Partial<Attribution>): void {
    if (!packId || !attribution) {
      return;
    }
    setAttributions((values) => ({
      ...values,
      [packId]: { ...attribution, draft: { ...attribution.draft, ...patch } },
    }));
  }
  useEffect(() => {
    onDirtyChange?.(attributionDirty);
  }, [attributionDirty, onDirtyChange]);
  useEffect(() => {
    if (!packId || attributions[packId]) {
      return;
    }
    let current = true;
    setError(null);
    void command<Attribution>("get_character_pack_attribution", { packId })
      .then((value) => {
        if (current) {
          setAttributions((values) =>
            values[packId] ? values : { ...values, [packId]: { saved: value, draft: value } },
          );
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setError(errorText(cause));
        }
      });
    return () => {
      current = false;
    };
  }, [packId, attributionRevision]);
  useEffect(() => {
    if (action === "import") {
      void choosePack();
    }
  }, [action]);
  const ids =
    (exportScope ?? scope) === "pair" && active.length > 1
      ? active
      : selectedId
        ? [selectedId]
        : [];
  const joining = installed.map((character) => character.id).filter((id) => !active.includes(id));
  async function run(action: () => Promise<void>): Promise<void> {
    if (lock.current || disabled) return;
    lock.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }
  async function choosePack(): Promise<void> {
    await run(async () => {
      const chosen = await command<CharacterPack | null>("choose_character_pack");
      if (chosen) {
        setPack(chosen);
        setInstalled([]);
      }
    });
  }
  const full = action === undefined;
  const content = (
    <section className={s.section} aria-label="캐릭터 공유">
      {full && <h2 className={s.subheading}>캐릭터 공유</h2>}
      <p className={s.notice}>
        이름·성격·지침·캐릭터 간 관계·표정·등록 대사를 공유해요. 관계는 함께 내보내는 캐릭터 사이의
        설정만 포함해요. 기억·친밀도·대화 기록은 선택한 경우에만 포함해요. API 키와 모델 파일은
        포함하지 않아요.
      </p>
      <fieldset className={s.fieldset} disabled={pending || disabled}>
        {packId && (full || action === "attribution") && (
          <>
            <p className={ui.quiet}>
              선택한 캐릭터의 원본 패키지 출처예요. 같은 패키지의 모든 캐릭터에 적용돼요.
            </p>
            <label className={ui.field}>
              제작자
              <TextField
                disabled={!attributionLoaded}
                value={author}
                maxLength={120}
                onChange={(event) => changeAttribution({ author: event.target.value })}
              />
            </label>
            <label className={ui.field}>
              출처 URL
              <TextField
                disabled={!attributionLoaded}
                value={sourceUrl}
                maxLength={2048}
                onChange={(event) => changeAttribution({ sourceUrl: event.target.value })}
                placeholder="https://…"
              />
            </label>
            <Button
              variant="secondary"
              disabled={!attributionLoaded}
              onClick={() =>
                void run(async () => {
                  await command("save_character_pack_attribution", {
                    packId,
                    value: { author, sourceUrl },
                  });
                  const saved = { author, sourceUrl };
                  setAttributions((values) => ({ ...values, [packId]: { saved, draft: saved } }));
                  setNotice("패키지 출처를 저장했어요.");
                })
              }
            >
              출처 저장
            </Button>
            {currentAttributionDirty && (
              <Button
                variant="quiet"
                size="compact"
                onClick={() => {
                  if (attribution) {
                    setAttributions((values) => ({
                      ...values,
                      [packId]: { ...attribution, draft: attribution.saved },
                    }));
                  }
                }}
              >
                출처 수정 취소
              </Button>
            )}
            {!attributionLoaded && error && (
              <Button
                variant="secondary"
                size="compact"
                onClick={() => setAttributionRevision((value) => value + 1)}
              >
                출처 다시 불러오기
              </Button>
            )}
          </>
        )}
        {(full || action === "export") && (
          <div>
            {!exportScope && (
              <label className={ui.field}>
                내보낼 대상
                <Select value={scope} onChange={(event) => setScope(event.target.value)}>
                  <option value="selected">선택한 캐릭터 하나</option>
                  <option value="pair" disabled={active.length < 2}>
                    함께 지내는 친구들의 조합
                  </option>
                </Select>
              </label>
            )}
            <p className={ui.quiet}>
              {ids
                .map(
                  (id) =>
                    snapshot.characters.installed.find((character) => character.id === id)
                      ?.definition.name ?? "",
                )
                .join(" + ")}{" "}
              · 저장된 내용으로 내보내요.
            </p>
            <div className={ui.row} role="group" aria-label="내보내기 구성">
              <Button
                variant="secondary"
                aria-pressed={
                  !options.includeMemories && !options.includeAffinity && !options.includeMessages
                }
                onClick={() =>
                  setOptions((value) => ({
                    ...value,
                    includeMemories: false,
                    includeAffinity: false,
                    includeMessages: false,
                  }))
                }
              >
                캐릭터만 내보내기
              </Button>
              <Button
                variant="secondary"
                aria-pressed={
                  options.includeMemories && !options.includeAffinity && !options.includeMessages
                }
                onClick={() =>
                  setOptions((value) => ({
                    ...value,
                    includeMemories: true,
                    includeAffinity: false,
                    includeMessages: false,
                  }))
                }
              >
                기억을 포함해 내보내기
              </Button>
            </div>
            <fieldset className={s.fieldset} aria-label="포함할 데이터">
              {(
                [
                  ["includeSprites", "스프라이트 포함"],
                  ["includeMemories", "기억 포함"],
                  ["includeAffinity", "친밀도 포함"],
                  ["includeMessages", "대화 기록 포함"],
                ] as const
              ).map(([key, label]) => (
                <Checkbox
                  key={key}
                  checked={options[key]}
                  onChange={(event) =>
                    setOptions((value) => ({ ...value, [key]: event.target.checked }))
                  }
                >
                  {label}
                </Checkbox>
              ))}
            </fieldset>
            <p className={ui.quiet}>
              스프라이트는 표정·말풍선 이미지와 애니메이션을 포함해요. 기억에는 유저명과 근거가 함께
              담겨요. 받는 사람과의 관계는 새로 시작해요.
            </p>
            {(options.includeMemories || options.includeAffinity || options.includeMessages) && (
              <p className={ui.quiet}>
                함께 지낸 사람의 정보가 들어 있어요. 공유할 내용을 확인해 주세요.
              </p>
            )}
            <details className={s.section}>
              <summary className={s.disclosureSummary}>
                개인 단어장 선택해서 포함하기 ({wordbookIds.length}개)
              </summary>
              <p className={ui.quiet}>
                기본으로 제외해요. 단일 캐릭터를 내보낼 때는 그 캐릭터만 말하는 항목을 선택해
                주세요.
              </p>
              {snapshot.wordbook.length === 0 ? (
                <p className={ui.quiet}>개인 단어장이 없어요.</p>
              ) : (
                snapshot.wordbook.map((entry) => (
                  <div className={s.line} key={entry.id}>
                    <Checkbox
                      disabled={pending || disabled}
                      checked={wordbookIds.includes(entry.id)}
                      onChange={(event) =>
                        setWordbookIds((values) =>
                          event.target.checked
                            ? [...values, entry.id]
                            : values.filter((id) => id !== entry.id),
                        )
                      }
                    >
                      {entry.title}
                    </Checkbox>
                    <p className={ui.quiet}>{entry.keywords.join(", ")}</p>
                    <div className={s.preview}>
                      {entry.lines.map((line, index) => (
                        <p key={index}>
                          {line.persona.toUpperCase()} [{line.expression}] {line.text}
                        </p>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </details>
            <div className={ui.row}>
              <Button
                variant="secondary"
                disabled={!ids.length || contentDirty || attributionDirty}
                onClick={() =>
                  void run(async () => {
                    const path = await command<string | null>("save_character_pack", {
                      ids,
                      wordbookIds,
                      options,
                    });
                    if (path) setNotice(`공유 파일을 저장했어요. ${path}`);
                  })
                }
              >
                공유 파일 내보내기
              </Button>
            </div>
            {(contentDirty || attributionDirty) && (
              <p className={s.small}>
                공유할 내용과 출처의 미저장 수정을 먼저 저장하거나 취소해 주세요.
              </p>
            )}
          </div>
        )}
        {(full || action === "import") && (
          <Button variant="secondary" size="compact" onClick={() => void choosePack()}>
            공유 파일 가져오기
          </Button>
        )}
        <p className={ui.quiet}>.comet-character.json · 최대 32 MiB · 온라인에 게시하지 않아요.</p>
        {pack && (full || action === "import") && (
          <section className={s.section} aria-label="가져오기 미리보기">
            <CharacterPackPreview pack={pack} />
            {installed.length === 0 ? (
              <div className={ui.row}>
                <Button
                  variant="primary"
                  onClick={() =>
                    void run(async () => {
                      const values = await command<InstalledCharacter[]>("import_character_pack", {
                        pack,
                      });
                      setInstalled(values);
                      setNotice("목록에 설치했어요. 함께 지낼지 선택해 주세요.");
                    })
                  }
                >
                  내용 확인 후 설치
                </Button>
                <Button variant="secondary" onClick={() => setPack(null)}>
                  가져오기 취소
                </Button>
              </div>
            ) : (
              <div className={ui.row}>
                <Button
                  variant="primary"
                  disabled={
                    contentDirty || joining.length === 0 || active.length + joining.length > 8
                  }
                  onClick={() =>
                    void run(async () => {
                      await command("apply_character_roster", { ids: [...active, ...joining] });
                      setNotice("가져온 친구가 함께 지내기 시작했어요.");
                    })
                  }
                >
                  가져온 친구와 함께 지내기
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPack(null);
                    setInstalled([]);
                  }}
                >
                  미리보기 닫기
                </Button>
              </div>
            )}
          </section>
        )}
      </fieldset>
      {pending && (
        <p className={ui.quiet} role="status">
          처리 중…
        </p>
      )}
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={ui.success} role="status">
          {notice}
        </p>
      )}
    </section>
  );
  if (full) {
    return content;
  }
  return (
    <>
      <div className={s.attributionSummary}>
        <span>팩 정보</span>
        <span className={`${s.small} ${s.lineSummary}`}>
          {packId
            ? `${author || "제작자 미등록"}${currentAttributionDirty ? " · 미저장" : ""}`
            : "직접 만든 캐릭터"}
        </span>
        <Button
          variant="secondary"
          size="compact"
          disabled={!packId || disabled}
          onClick={() => onActionChange?.("attribution")}
        >
          정보·출처 편집
        </Button>
        <span>출처</span>
        <span className={`${s.small} ${s.lineSummary}`}>{sourceUrl || "등록된 출처 없음"}</span>
      </div>
      <Dialog
        closeLabel="닫기"
        isOpen={action !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            onActionChange?.(null);
          }
        }}
        onCancel={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        title={
          action === "import"
            ? "캐릭터 가져오기"
            : action === "export"
              ? "파일로 내보내기"
              : "팩 정보·출처"
        }
        size="large"
      >
        {content}
      </Dialog>
    </>
  );
}
