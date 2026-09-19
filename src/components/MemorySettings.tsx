import { useEffect, useState, type JSX } from "react";
import { Button, TextArea } from "@fleetia/lagrange";
import type { Memory } from "../types";
import { command, errorText } from "../hooks/useSnapshot";
import * as s from "../lagrange.css";

function MemoryRow({ memory }: { memory: Memory }): JSX.Element {
  const [value, setValue] = useState(memory.content);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(memory.content), [memory.content]);
  async function update(remove: boolean): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await command(
        remove ? "delete_memory" : "edit_memory",
        remove ? { id: memory.id } : { id: memory.id, content: value.trim() },
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={s.memory}>
      <TextArea
        aria-label="기억 내용"
        disabled={pending}
        value={value}
        maxLength={500}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className={s.row}>
        <Button
          variant="secondary"
          disabled={pending || !value.trim() || value === memory.content}
          onClick={() => void update(false)}
        >
          수정 저장
        </Button>
        <Button variant="quiet" disabled={pending} onClick={() => void update(true)}>
          이 기억 지우기
        </Button>
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function MemorySettings({ memories }: { memories: Memory[] }): JSX.Element {
  return (
    <section>
      <h2 className={s.sectionTitle}>
        함께 기억하는 것 <span className={s.quiet}>{memories.length}개</span>
      </h2>
      <p className={s.quiet}>
        대화에서 남긴 짧은 기억이에요. 잘못 기억한 내용은 고치거나 지울 수 있어요.
      </p>
      {memories.length === 0 ? (
        <p className={s.emptyHint}>아직 기억이 없어요. 이야기를 나누며 하나씩 쌓아 갈게요.</p>
      ) : (
        memories.map((memory) => <MemoryRow key={memory.id} memory={memory} />)
      )}
    </section>
  );
}
