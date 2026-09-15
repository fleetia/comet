import { useRef, useState, type JSX } from "react";
import { command, errorText } from "../hooks/useSnapshot";
import type { CharacterPack, InstalledCharacter, Snapshot } from "../types";
import * as ui from "../styles.css";
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
  const ids = scope === "pair" ? snapshot.characters.active : selectedId ? [selectedId] : [];
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
        이름·성격·표정·등록 대사만 공유해요. 대화 기록·기억·친밀도·API 키·모델 파일은 포함하지
        않아요. 직접 적은 소개나 대사에 개인정보가 없는지도 확인해 주세요.
      </p>
      <fieldset className={s.fieldset} disabled={pending || disabled}>
        <label className={ui.field}>
          내보낼 대상
          <select
            className={ui.input}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="selected">선택한 캐릭터 하나</option>
            <option value="pair">현재 A/B 둘의 조합</option>
          </select>
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
          <summary>개인 단어장 선택해서 포함하기 ({wordbookIds.length}개)</summary>
          <p className={ui.quiet}>
            기본으로 제외해요. 단일 캐릭터를 내보낼 때는 그 캐릭터만 말하는 항목을 선택해 주세요.
          </p>
          {snapshot.wordbook.length === 0 ? (
            <p className={ui.quiet}>개인 단어장이 없어요.</p>
          ) : (
            snapshot.wordbook.map((entry) => (
              <div className={s.line} key={entry.id}>
                <label className={ui.row}>
                  <input
                    type="checkbox"
                    checked={wordbookIds.includes(entry.id)}
                    onChange={(event) =>
                      setWordbookIds((values) =>
                        event.target.checked
                          ? [...values, entry.id]
                          : values.filter((id) => id !== entry.id),
                      )
                    }
                  />
                  {entry.title}
                </label>
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
          <button
            className={ui.button}
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
          </button>
          <button
            className={ui.button}
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
          </button>
        </div>
        <p className={ui.quiet}>.comet-character.json · 최대 1 MiB · 온라인에 게시하지 않아요.</p>
        {pack && (
          <section className={s.section} aria-label="가져오기 미리보기">
            <h3 className={s.subheading}>{pack.name}</h3>
            <p className={ui.quiet}>
              제작자: {pack.author || "미지정"} · 형식 버전 {pack.formatVersion}
            </p>
            <p className={s.preview}>
              배포 조건: {pack.license || "미지정 — 재배포 조건을 제작자에게 확인해 주세요."}
            </p>
            {pack.characters.map((character, index) => (
              <details key={`${character.sourceId}:${index}`} open>
                <summary>
                  {character.name} · 버전 {character.version}
                </summary>
                <div className={s.preview}>
                  <p>{character.description}</p>
                  <p>성격과 말투: {character.personality}</p>
                  <p>
                    {Object.entries(character.expressions)
                      .map(([key, value]) => `${key} [${value}]`)
                      .join(" · ")}
                  </p>
                  <strong>인사</strong>
                  {character.greeting.map((line, i) => (
                    <p key={i}>
                      [{line.expression}] {line.text}
                    </p>
                  ))}
                  <strong>자동 수다</strong>
                  {character.idleLines.map((line, i) => (
                    <p key={i}>
                      [{line.expression}] {line.text}
                    </p>
                  ))}
                </div>
              </details>
            ))}
            <details>
              <summary>
                조합 대사 {pack.pairScenes.length}개 · 키워드 대사 {pack.wordbook.length}개
              </summary>
              <div className={s.preview}>
                {pack.pairScenes.map((lines, index) => (
                  <div key={index}>
                    {lines.map((line, i) => (
                      <p key={i}>
                        {line.persona.toUpperCase()} [{line.expression}] {line.text}
                      </p>
                    ))}
                  </div>
                ))}
                {pack.wordbook.map((entry) => (
                  <div key={entry.id}>
                    <strong>
                      {entry.title} · {entry.keywords.join(", ")}
                    </strong>
                    {entry.lines.map((line, i) => (
                      <p key={i}>
                        {line.persona.toUpperCase()} [{line.expression}] {line.text}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
            {installed.length === 0 ? (
              <div className={ui.row}>
                <button
                  className={ui.primary}
                  onClick={() =>
                    void run(async () => {
                      const values = await command<InstalledCharacter[]>("import_character_pack", {
                        pack,
                      });
                      setInstalled(values);
                      setNotice("목록에 설치했어요. 사용할 자리를 선택해 주세요.");
                    })
                  }
                >
                  내용 확인 후 설치
                </button>
                <button className={ui.button} onClick={() => setPack(null)}>
                  가져오기 취소
                </button>
              </div>
            ) : (
              <div className={ui.row}>
                {installed.length === 2 ? (
                  <button
                    className={ui.primary}
                    onClick={() =>
                      void run(async () => {
                        await command("apply_character_pair", {
                          ids: installed.map((character) => character.id),
                        });
                        setNotice("가져온 둘을 A/B에 적용했어요.");
                      })
                    }
                  >
                    가져온 둘을 A/B에 적용
                  </button>
                ) : (
                  ["a", "b"].map((persona) => (
                    <button
                      className={ui.primary}
                      key={persona}
                      onClick={() =>
                        void run(async () => {
                          await command("assign_character", { persona, id: installed[0].id });
                          setNotice(`${persona.toUpperCase()}에 적용했어요.`);
                        })
                      }
                    >
                      {persona.toUpperCase()}에 적용
                    </button>
                  ))
                )}
                <button
                  className={ui.button}
                  onClick={() => {
                    setPack(null);
                    setInstalled([]);
                  }}
                >
                  미리보기 닫기
                </button>
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
