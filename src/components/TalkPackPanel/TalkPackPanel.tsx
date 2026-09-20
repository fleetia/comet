import { useEffect, useRef, useState, type JSX } from "react";
import { Button } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { TalkPack } from "../../types";
import * as s from "../../lagrange.css";
import * as d from "../../desktop.css";
import * as layout from "../SettingsPanel/settings.css";

const PREVIEW_PACKS: TalkPack[] = [
  {
    id: "byulkkori",
    name: "별꼬리 기본 대화",
    description: "시간·날씨·위젯 상태에 반응하는 밝고 짧은 기본 대화. 무작위 화자가 말해요.",
    installed: true,
    bundled: true,
    defaultInstalled: true,
  },
  {
    id: "nadir-and-star-tail",
    name: "나디르와 별꼬리",
    description: "나디르·별꼬리 추가팩 전용 대화. 두 캐릭터가 함께 지낼 때만 재생돼요.",
    installed: false,
    bundled: true,
    defaultInstalled: false,
  },
];

export function TalkPackPanel(): JSX.Element {
  const [packs, setPacks] = useState<TalkPack[] | null>(isDesktop() ? null : PREVIEW_PACKS);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void command<TalkPack[]>("get_talk_packs")
      .then((value) => {
        if (active) setPacks(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(pack: TalkPack, install: boolean): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(pack.id);
    setError(null);
    setNotice(null);
    try {
      const next = await command<TalkPack[]>(install ? "install_talk_pack" : "remove_talk_pack", {
        id: pack.id,
      });
      setPacks(next);
      setNotice(
        install
          ? `${pack.name} 대화팩을 설치했어요. 잠시 뒤 대사가 반영돼요.`
          : `${pack.name} 대화팩을 제거했어요. 다시 시작해도 되살리지 않아요.`,
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  return (
    <section aria-label="대화팩">
      <p className={d.info}>
        대화팩은 시간·날씨·위젯 상태에 맞춰 캐릭터가 먼저 하는 말이에요. 기본팩은 함께 지내는 친구
        1~8명 중 무작위로 화자를 고르고, 제거하면 다시 시작해도 되살리지 않아요. 나만의 대본은 앱
        데이터의 talk/index.talk에 그대로 남아요.
      </p>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={s.success} role="status">
          {notice}
        </p>
      )}
      {packs === null ? (
        <p className={s.quiet} role="status">
          대화팩 목록을 읽고 있어요.
        </p>
      ) : (
        <ul className={layout.packList} aria-label="대화팩 목록">
          {packs.map((pack) => (
            <li key={pack.id} className={layout.packRow}>
              <div>
                <p className={s.sectionTitle}>
                  {pack.name}
                  <span className={s.quiet}>
                    {" · "}
                    {pack.installed ? "설치됨" : "설치 안 됨"}
                    {pack.defaultInstalled ? " · 기본" : ""}
                    {pack.bundled ? "" : " · 직접 추가한 팩"}
                  </span>
                </p>
                {pack.description && <p className={s.quiet}>{pack.description}</p>}
              </div>
              <div className={s.row}>
                {pack.installed ? (
                  <Button
                    variant="secondary"
                    disabled={pending !== null}
                    aria-label={`${pack.name} 제거`}
                    onClick={() => void run(pack, false)}
                  >
                    {pending === pack.id ? "제거 중…" : "제거"}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={pending !== null || !pack.bundled}
                    aria-label={`${pack.name} 설치`}
                    onClick={() => void run(pack, true)}
                  >
                    {pending === pack.id ? "설치 중…" : "설치"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
