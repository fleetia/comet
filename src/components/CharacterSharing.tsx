import { useRef, useState, type JSX } from "react";
import { Button, Checkbox, Select } from "@fleetia/lagrange";
import { command, errorText } from "../hooks/useSnapshot";
import type { CharacterPack, InstalledCharacter, Snapshot } from "../types";
import { CharacterPackPreview } from "./CharacterPackPreview";
import * as ui from "../lagrange.css";
import * as s from "./characters.css";

type Props = {
  snapshot: Snapshot;
  selectedId: string | null;
  disabled: boolean;
  onPendingChange?: (pending: boolean) => void;
};
export function CharacterSharing({
  snapshot,
  selectedId,
  disabled,
  onPendingChange,
}: Props): JSX.Element {
  const [scope, setScope] = useState("selected");
  const [wordbookIds, setWordbookIds] = useState<string[]>([]);
  const [pack, setPack] = useState<CharacterPack | null>(null);
  const [installed, setInstalled] = useState<InstalledCharacter[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const { active } = snapshot.characters;
  const ids = scope === "pair" && active.length === 2 ? active : selectedId ? [selectedId] : [];
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
  return (
    <section className={s.section} aria-label="캐릭터 공유">
      <h2 className={s.subheading}>캐릭터 공유</h2>
      <p className={s.notice}>
        이름·성격·표정과 표정 이미지·등록 대사만 공유해요. 대화 기록·기억·친밀도·API 키·모델 파일은
        포함하지 않아요. 직접 적은 소개나 대사에 개인정보가 없는지도 확인해 주세요.
      </p>
      <fieldset className={s.fieldset} disabled={pending || disabled}>
        <label className={ui.field}>
          내보낼 대상
          <Select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="selected">선택한 캐릭터 하나</option>
            <option value="pair" disabled={active.length !== 2}>
              함께 지내는 둘의 조합
            </option>
          </Select>
        </label>
        <p className={ui.quiet}>
          {ids
            .map(
              (id) =>
                snapshot.characters.installed.find((character) => character.id === id)?.definition
                  .name ?? "",
            )
            .join(" + ")}{" "}
          · 저장된 내용으로 내보내요.
        </p>
        <details className={s.section}>
          <summary className={s.disclosureSummary}>
            개인 단어장 선택해서 포함하기 ({wordbookIds.length}개)
          </summary>
          <p className={ui.quiet}>
            기본으로 제외해요. 단일 캐릭터를 내보낼 때는 그 캐릭터만 말하는 항목을 선택해 주세요.
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
            disabled={!ids.length}
            onClick={() =>
              void run(async () => {
                const path = await command<string | null>("save_character_pack", {
                  ids,
                  wordbookIds,
                });
                if (path) setNotice(`공유 파일을 저장했어요. ${path}`);
              })
            }
          >
            공유 파일 내보내기
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void run(async () => {
                const chosen = await command<CharacterPack | null>("choose_character_pack");
                if (chosen) {
                  setPack(chosen);
                  setInstalled([]);
                }
              })
            }
          >
            공유 파일 가져오기
          </Button>
        </div>
        <p className={ui.quiet}>.comet-character.json · 최대 32 MiB · 온라인에 게시하지 않아요.</p>
        {pack && (
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
                  disabled={joining.length === 0 || active.length + joining.length > 8}
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
}
