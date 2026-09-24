import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Dialog } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { InstalledCharacter } from "../../types";
import * as s from "../../lagrange.css";

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
    <section aria-label="캐릭터 설정">
      <h3 className={s.sectionTitle}>캐릭터 내보내기</h3>
      <p className={s.quiet}>이 캐릭터와 함께 보낼 스프라이트·기억·친밀도·대화 기록을 선택해요.</p>
      <Button
        variant="secondary"
        disabled={disabled || exportDisabled || pending}
        onClick={onExport}
      >
        이 캐릭터 내보내기
      </Button>
      <section className={s.section}>
        <h3 className={s.sectionTitle}>기억 잊기</h3>
        <p className={s.quiet}>
          이 캐릭터가 함께 지낸 모든 사람에 관한 기억을 잊어요. 대화 원문과 친밀도는 보존해요.
        </p>
        <Button
          variant="quiet"
          disabled={disabled || pending || memoryDirty || count === null || count === 0}
          onClick={() => setConfirm(true)}
        >
          이 캐릭터의 기억 전체 잊기{count !== null ? ` (${count}개)` : ""}
        </Button>
        {memoryDirty && (
          <p className={s.quiet}>
            편집 중인 기억을 저장하거나 취소한 뒤 전체 기억을 잊을 수 있어요.
          </p>
        )}
      </section>
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
