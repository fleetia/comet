import { useEffect, useRef, useState, type JSX } from "react";
import { Button, SectionHeader, SelectableListRow, Surface } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { TalkPack } from "../../types";
import * as s from "../../lagrange.css";
import * as t from "./TalkPackPanel.css";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = packs?.find((pack) => pack.id === selectedId) ?? packs?.[0];
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
    <section className={t.workspace} aria-label="대화팩">
      <Surface className={t.catalogue}>
        <SectionHeader
          className={t.catalogueHeading}
          title="동봉 대화팩"
          headingVariant="subsection"
          rule="none"
        />
        <p className={s.quiet}>
          설치됨 {packs?.filter((pack) => pack.installed).length ?? 0} · 추가 가능{" "}
          {packs?.filter((pack) => !pack.installed).length ?? 0}
        </p>
        {packs === null ? (
          <p className={s.quiet} role="status">
            대화팩 목록을 읽고 있어요.
          </p>
        ) : (
          <ul className={t.list} aria-label="대화팩 목록">
            {packs.map((pack) => (
              <li key={pack.id}>
                <SelectableListRow
                  className={t.item}
                  selected={selected?.id === pack.id}
                  disabled={pending !== null}
                  onClick={() => {
                    setSelectedId(pack.id);
                    setError(null);
                    setNotice(null);
                  }}
                  aria-label={`${pack.name} 선택`}
                >
                  <strong>{pack.name}</strong>
                  <span className={t.caption}>
                    {pack.bundled ? "동봉" : "직접 추가한 팩"} ·{" "}
                    {pack.installed ? "설치됨" : "설치 안 됨"}
                    {pack.defaultInstalled ? " · 기본 설치" : ""}
                  </span>
                </SelectableListRow>
              </li>
            ))}
          </ul>
        )}
      </Surface>
      <Surface className={t.detail}>
        {selected && (
          <>
            <div className={t.header}>
              <SectionHeader title={selected.name} headingVariant="subsection" rule="none" />
              <span className={t.status}>{selected.installed ? "설치됨" : "설치 안 됨"}</span>
            </div>
            {selected.description && <p>{selected.description}</p>}
            <Surface tone="accent" className={t.context}>
              <strong>
                {selected.id === "nadir-and-star-tail"
                  ? "나디르와 별꼬리가 이야기해요"
                  : "함께 지내는 친구가 이야기해요"}
              </strong>
              <p>
                {selected.id === "nadir-and-star-tail"
                  ? "나디르·별꼬리가 함께 지낼 때 재생돼요."
                  : "함께 지내는 1~8명 중 무작위로 화자를 골라요."}
              </p>
            </Surface>
            <div className={t.actions}>
              <Button
                className={t.actionButton}
                variant={selected.installed ? "secondary" : "primary"}
                disabled={pending !== null || (!selected.installed && !selected.bundled)}
                aria-label={`${selected.name} ${selected.installed ? "제거" : "설치"}`}
                onClick={() => void run(selected, !selected.installed)}
              >
                {pending === selected.id
                  ? selected.installed
                    ? "제거 중…"
                    : "설치 중…"
                  : selected.installed
                    ? "대화팩 제거"
                    : "대화팩 설치"}
              </Button>
              <span className={s.quiet}>
                {selected.installed
                  ? "이 팩의 대화만 멈춰요."
                  : "설치하면 잠시 뒤 대사가 반영돼요."}
              </span>
            </div>
          </>
        )}
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
        <section className={t.manuscript} aria-label="나만의 대본">
          <strong>나만의 대본</strong>
          <p className={s.quiet}>
            원문 작성·검사·저장은 별도 talk editor에서 해요. 유효하게 저장된 파일은 실행 중 자동으로
            다시 읽어요.
          </p>
          <p className={s.quiet}>talk/index.talk · 사용자 원문 보관</p>
        </section>
      </Surface>
    </section>
  );
}
