import { useRef, useState, type JSX } from "react";
import { Button, TextInput } from "@comet/ui";
import type { Dispatch } from "../../types";
import { errorText } from "../../hooks/useSnapshot";
import { BirthdayFields, birthdayDraft, birthdayValue } from "../BirthdayFields";
import * as s from "../companion.css";

export function NameRegistration({
  greeting,
  dispatch,
  sceneAskId,
  prompt = "뭐라고 부를까?",
}: {
  greeting: string;
  dispatch: Dispatch;
  sceneAskId?: string;
  prompt?: string;
}): JSX.Element {
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState(() => birthdayDraft(null));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const composing = useRef(false);
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  const selectedBirthday = birthdayValue(birthday);
  const valid =
    length > 0 && length <= 40 && !/\p{Cc}/u.test(trimmed) && selectedBirthday !== undefined;

  async function save(): Promise<void> {
    if (!valid || busy.current || composing.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatch("register_user_profile", {
        name: trimmed,
        birthday: selectedBirthday,
        ...(sceneAskId ? { sceneAskId } : {}),
      });
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form
      className={s.form}
      aria-label="이름 알려주기"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {greeting && <p className={s.conversationMeta}>{greeting}</p>}
      <label htmlFor="first-user-name">{prompt}</label>
      <TextInput
        fill
        id="first-user-name"
        autoComplete="off"
        aria-describedby="first-user-name-hint"
        value={name}
        disabled={pending}
        onChange={(event) => setName(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229)
          ) {
            event.preventDefault();
          }
        }}
      />
      <p id="first-user-name-hint" className={s.conversationMeta}>
        1~40자로 알려 줘. 나중에 설정 → 일반 → 사용자에서 바꿀 수 있어.
      </p>
      <span>생일 (선택)</span>
      <BirthdayFields value={birthday} onChange={setBirthday} disabled={pending} />
      {selectedBirthday === undefined && <p className={s.error}>올바른 월과 일을 선택해 줘.</p>}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!valid || pending}>
        {pending ? "저장 중…" : "이름 알려주기"}
      </Button>
    </form>
  );
}
