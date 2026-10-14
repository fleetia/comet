import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, SectionHeader, SettingsRow } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
import * as layout from "../SettingsPanel/settings.css";

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
    <section className={layout.sectionBody} aria-labelledby="autostart-title" aria-busy={pending}>
      <SectionHeader
        title="시작"
        headingId="autostart-title"
        headingVariant="subsection"
        rule="none"
      />
      <SettingsRow
        className={layout.settingsRow}
        label={<span id="autostart-label">컴퓨터 로그인 시 자동 실행</span>}
        description="로그인한 사용자의 등록 상태"
      >
        <Checkbox
          className={layout.rowControl}
          aria-labelledby="autostart-label"
          checked={enabled === true}
          disabled={!isDesktop() || pending || enabled === null}
          onChange={(event) => void run(event.target.checked)}
        >
          자동 실행
        </Checkbox>
      </SettingsRow>
      <div className={layout.statusRow}>
        <p className={s.quiet} role="status">
          {pending
            ? "자동 실행 설정을 확인하고 있어요."
            : enabled === null
              ? "등록 상태 미확인"
              : `${enabled ? "켜짐" : "꺼짐"} · 확인 완료`}
        </p>
        <p className={s.quiet}>변경하면 바로 반영</p>
      </div>
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
