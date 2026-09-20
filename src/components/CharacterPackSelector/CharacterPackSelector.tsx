import { useEffect, useRef, useState, type JSX } from "react";
import { Button, FormField, Inline, Select } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { CharacterCollection, InstalledCharacterPack } from "../../types";
import * as ui from "../../lagrange.css";
import * as s from "../characters.css";

type Props = {
  characters: CharacterCollection;
  disabled: boolean;
  hasUnsavedChanges: boolean;
  onPendingChange: (pending: boolean) => void;
  onApplied: (characterId: string) => void;
};

export function CharacterPackSelector({
  characters,
  disabled,
  hasUnsavedChanges,
  onPendingChange,
  onApplied,
}: Props): JSX.Element {
  const [packs, setPacks] = useState<InstalledCharacterPack[] | null>(isDesktop() ? null : []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const membership = JSON.stringify(characters.installed.map(({ id, packId }) => [id, packId]));

  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let current = true;
    setPacks(null);
    setError(null);
    void command<InstalledCharacterPack[]>("get_character_packs")
      .then((value) => {
        if (current) {
          setPacks(value);
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
  }, [membership, revision]);

  const currentPack = packs?.find(
    (pack) =>
      pack.characterIds.length === characters.active.length &&
      pack.characterIds.every((id, index) => id === characters.active[index]),
  );
  const selected = packs?.find((pack) => pack.id === (selectedId ?? currentPack?.id));
  const isApplied = Boolean(selected && selected.id === currentPack?.id);
  const busy = disabled || pending || hasUnsavedChanges;

  async function apply(): Promise<void> {
    if (!selected || busy || lock.current || isApplied) {
      return;
    }
    lock.current = true;
    setPending(true);
    onPendingChange(true);
    setError(null);
    setNotice(null);
    try {
      await command("apply_character_pack", { packId: selected.id });
      onApplied(selected.characterIds[0]);
      setNotice(`${selected.name} 팩으로 바꿨어요.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
      onPendingChange(false);
    }
  }

  return (
    <section className={s.packSelector} aria-label="캐릭터 팩 선택">
      <p className={ui.quiet}>
        팩을 선택한 뒤 순서를 확인하고 적용해 주세요. 선택만으로 함께 지내는 친구가 바뀌지 않아요.
      </p>
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
      {packs === null &&
        (error ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            팩 목록 다시 불러오기
          </Button>
        ) : (
          <p className={ui.quiet} role="status">
            설치한 팩을 불러오고 있어요.
          </p>
        ))}
      {packs?.length === 0 && (
        <p className={ui.quiet}>
          설치한 캐릭터 팩이 없어요. 캐릭터 목록의 가져오기로 파일을 설치하면 여기서 선택할 수
          있어요.
        </p>
      )}
      {packs && packs.length > 0 && (
        <>
          <Inline wrap align="end" gap="md" className={s.packControls}>
            <FormField className={s.packField} label="설치한 캐릭터 팩">
              <Select
                value={selected?.id ?? ""}
                disabled={busy}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setError(null);
                  setNotice(null);
                }}
              >
                <option value="">팩을 선택해 주세요</option>
                {packs.map((pack, index) => (
                  <option key={pack.id} value={pack.id}>
                    {index + 1}. {pack.name} · {pack.characterIds.length}명
                  </option>
                ))}
              </Select>
            </FormField>
            <Button
              variant="primary"
              disabled={busy || !selected || isApplied}
              onClick={() => void apply()}
            >
              {pending ? "전환 중…" : isApplied ? "함께 지내는 중" : "이 팩으로 함께 지내기"}
            </Button>
          </Inline>
          {selected && (
            <p className={ui.quiet}>
              함께 지낼 순서:{" "}
              {selected.characterIds
                .map(
                  (id) =>
                    characters.installed.find((character) => character.id === id)?.definition.name,
                )
                .join(" → ")}
              <span className={s.packHint}>기록과 친밀도는 그대로 남아요.</span>
            </p>
          )}
          {hasUnsavedChanges && (
            <p className={ui.quiet}>
              수정 중인 캐릭터와 대사를 저장하거나 취소한 뒤 팩을 바꿔 주세요.
            </p>
          )}
        </>
      )}
    </section>
  );
}
