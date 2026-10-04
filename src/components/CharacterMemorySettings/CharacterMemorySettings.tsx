import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Dialog, Surface } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { InstalledCharacter } from "../../types";
import { CharacterWorkPanel } from "../CharacterEditor/CharacterWorkPanel";
import * as s from "../../lagrange.css";
import * as layout from "./CharacterMemorySettings.css";

export function CharacterMemorySettings({
  character,
  memoryRevision,
  disabled,
  exportDisabled = false,
  memoryDirty,
  onExport,
  onForgot,
}: {
  character: InstalledCharacter;
  memoryRevision: number;
  disabled: boolean;
  exportDisabled?: boolean;
  memoryDirty: boolean;
  onExport: () => void;
  onForgot: () => void;
}): JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!isDesktop()) {
      setCount(0);
      return;
    }
    let active = true;
    setCount(null);
    void command<number>("count_character_memories", { characterId: character.id })
      .then((total) => {
        if (active) {
          setCount(total);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [character.id, memoryRevision, refresh]);
  async function forget(): Promise<void> {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await command("forget_character_memories", { characterId: character.id });
      setConfirm(false);
      setCount(0);
      setNotice("이 캐릭터의 기억을 모두 잊었어요.");
      onForgot();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label="캐릭터 설정" className={layout.workspace}>
      <div className={layout.actions}>
        <CharacterWorkPanel>
          <h3 className={s.sectionTitle}>캐릭터 내보내기</h3>
          <div className={layout.commandRow}>
            <p>{character.definition.name}의 프로필·모습·등록 대사를 JSON 파일로 공유해요.</p>
            <Button
              variant="primary"
              disabled={disabled || exportDisabled || pending}
              onClick={onExport}
            >
              이 캐릭터 내보내기
            </Button>
          </div>
          <p className={s.quiet}>
            저장된 내용을 내보내요. 기억·친밀도·대화 기록은 포함할 자료를 선택해요.
          </p>
          <section className={layout.boundary}>
            <h3 className={s.sectionTitle}>기억 전체 잊기</h3>
            <div className={layout.commandRow}>
              <p>
                {character.definition.name}의 기억 {count === null ? "확인 중" : `${count}개`}
                <br />
                모든 사용자에 대해 남긴 기억
              </p>
              <Button
                variant="quiet"
                disabled={disabled || pending || memoryDirty || count === null || count === 0}
                onClick={() => setConfirm(true)}
              >
                이 캐릭터의 기억 전체 잊기{count !== null ? ` (${count}개)` : ""}
              </Button>
            </div>
            <p className={s.quiet}>건수를 확인한 뒤 실행해요. 대화 원문과 친밀도는 유지돼요.</p>
            {memoryDirty && (
              <p className={s.quiet}>
                편집 중인 기억을 저장하거나 취소한 뒤 전체 기억을 잊을 수 있어요.
              </p>
            )}
          </section>
        </CharacterWorkPanel>
        <CharacterWorkPanel>
          <h3 className={s.sectionTitle}>{character.definition.name}에 포함된 콘텐츠</h3>
          <Surface tone="accent" padding="inline" className={layout.identity}>
            <strong>{character.definition.name}</strong>
            <span>보유 중 · 기억 {count === null ? "확인 중" : `${count}개`}</span>
          </Surface>
          <div className={layout.detailRow}>
            <span className={s.quiet}>프로필</span>
            <span>이름·소개·성격·지침</span>
          </div>
          <div className={layout.detailRow}>
            <span className={s.quiet}>표현 자산</span>
            <span>
              표정 {Object.keys(character.definition.expressions).length}개 · 동작{" "}
              {character.definition.animation?.clips.length ?? 0}개
            </span>
          </div>
          <div className={layout.detailRow}>
            <span className={s.quiet}>등록 대사</span>
            <span>
              인사 {character.definition.greeting.length}줄 · 수다{" "}
              {character.definition.idleLines.length}줄 · 떠남{" "}
              {character.definition.departureLines.length}줄 · 복귀{" "}
              {character.definition.returnLines.length}줄 · 사건 반응{" "}
              {character.definition.reactions?.length ?? 0}개
            </span>
          </div>
          <div className={layout.detailRow}>
            <span className={s.quiet}>공유 형식</span>
            <span>UTF-8 JSON · 최대 32 MiB</span>
          </div>
          <Surface tone="inset" padding="compact">
            <p className={s.quiet}>
              스프라이트·기억·친밀도·대화 기록의 포함 여부는 내보낼 때 선택해요. API 키와 모델
              파일은 포함하지 않아요.
            </p>
          </Surface>
        </CharacterWorkPanel>
      </div>
      {error && !confirm && (
        <div role="alert" className={s.error}>
          {error}
          <Button variant="quiet" onClick={() => setRefresh((value) => value + 1)}>
            다시 불러오기
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className={s.success}>
          {notice}
        </p>
      )}
      <Dialog
        isOpen={confirm}
        title="기억을 모두 잊을까요?"
        size="small"
        onOpenChange={(open) => {
          if (!pending) setConfirm(open);
        }}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        footer={
          <div className={s.row}>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirm(false)}>
              취소
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => void forget()}>
              전체 기억 잊기 확인
            </Button>
          </div>
        }
      >
        <p>
          {character.definition.name}의 기억 {count ?? 0}개를 모두 잊어요. 다른 캐릭터의 기억은 남아
          있어요. 이 작업은 되돌릴 수 없어요.
        </p>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </Dialog>
    </section>
  );
}
