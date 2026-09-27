import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";

export function AutostartSettings({ active }: { active: boolean }): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(async (next?: boolean): Promise<void> => {
    if (!isDesktop() || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const value =
        next === undefined
          ? await command<boolean>("get_autostart_enabled")
          : await command<boolean>("set_autostart_enabled", { enabled: next });
      setEnabled(value);
    } catch (cause) {
      setEnabled(null);
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const refresh = (): void => {
      void run();
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active, run]);

  return (
    <section className={s.section} aria-labelledby="autostart-title" aria-busy={pending}>
      <h2 className={s.sectionTitle} id="autostart-title">
        시작
      </h2>
      <Checkbox
        checked={enabled === true}
        disabled={!isDesktop() || pending || enabled === null}
        onChange={(event) => void run(event.target.checked)}
      >
        컴퓨터 로그인 시 자동 실행
      </Checkbox>
      {pending && (
        <p className={s.quiet} role="status">
          자동 실행 설정을 확인하고 있어요.
        </p>
      )}
      {error && (
        <div className={s.row}>
          <p className={s.error} role="alert">
            {error}
          </p>
          <Button variant="quiet" disabled={pending} onClick={() => void run()}>
            다시 확인
          </Button>
        </div>
      )}
    </section>
  );
}
