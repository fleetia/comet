import { useRef, useState, type JSX } from "react";
import { Button, TextField } from "@fleetia/lagrange";
import type { Dispatch } from "../../types";
import { errorText } from "../../hooks/useSnapshot";
import * as s from "../companion.css";

export function NameRegistration({
  greeting,
  dispatch,
}: {
  greeting: string;
  dispatch: Dispatch;
}): JSX.Element {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const composing = useRef(false);
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  const valid = length > 0 && length <= 40 && !/\p{Cc}/u.test(trimmed);

  async function save(): Promise<void> {
    if (!valid || busy.current || composing.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatch("register_user_name", { name: trimmed });
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
      <p className={s.conversationMeta}>{greeting}</p>
      <label htmlFor="first-user-name">뭐라고 부를까?</label>
      <TextField
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
        1~40자로 알려 줘. 나중에 설정에서 바꿀 수 있어.
      </p>
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
