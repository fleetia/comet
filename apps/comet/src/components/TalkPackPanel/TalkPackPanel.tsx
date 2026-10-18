import { useEffect, useRef, useState, type JSX } from "react";
import { Balloon as PreviewBalloon, Button, SettingControlRow, Switch } from "@comet/ui";
import { ChatIcon, ImportIcon, TogetherIcon } from "@comet/icon";
import byulBody from "../../assets/figma/talk-byul-body.svg";
import byulFace from "../../assets/figma/talk-byul-face.svg";
import * as figma from "../SettingsPanel/figmaSettings.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { TalkPack } from "../../types";
import * as s from "../../common.css";
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
    <section className={figma.split} aria-label="대화팩">
      <aside className={figma.inspector}>
        <h1 className={figma.inspectorTitle}>
          <span className={figma.icon}>
            <ChatIcon size={18} />
          </span>
          대화팩
        </h1>
        <p className={figma.caption}>
          시간·날씨·위젯에 맞춰 친구들이 이야기해요. 대화팩은 대사만 담아요.
        </p>
        <div className={t.scene} aria-label="나디르와 별꼬리 대화 예시">
          <PreviewBalloon className={t.firstBalloon} speaker="byulkkori" tail="left">
            구름이 조금 꼈네. 산책하기 딱 좋겠다!
          </PreviewBalloon>
          <PreviewBalloon className={t.secondBalloon} speaker="nadir" tail="right">
            그럼 간식도 챙겨 갈까요.
          </PreviewBalloon>
          <div className={t.sceneCharacters}>
            <span className={t.byul}>
              <img src={byulBody} alt="" className={t.byulBody} />
              <img src={byulFace} alt="" className={t.byulFace} />
            </span>
            <span className={t.nadir}>(¬‿¬)</span>
          </div>
        </div>
        <p className={figma.caption}>나디르와 별꼬리 팩 · 날씨 위젯이 ‘구름 조금’일 때</p>
        <p className={t.note}>팩을 끄면 그 팩의 대사만 쉬어요. 단어장과 반응 대사는 그대로예요.</p>
        {selected && (
          <div className={figma.note}>
            <div className={figma.noteCopy}>
              <h2 className={figma.sectionTitle}>{selected.name}</h2>
              <p className={figma.caption}>{selected.description}</p>
            </div>
          </div>
        )}
      </aside>
      <div className={figma.right}>
        <section className={figma.section}>
          <h2 className={figma.sectionTitle}>설치한 대화팩</h2>
          <div className={figma.summaryGrid}>
            {packs
              ?.filter((pack) => pack.installed)
              .map((pack) => (
                <div key={pack.id} className={t.installedCard}>
                  <span className={figma.icon}>
                    {pack.id === "nadir-and-star-tail" ? (
                      <TogetherIcon size={20} />
                    ) : (
                      <ChatIcon size={20} />
                    )}
                  </span>
                  <button
                    type="button"
                    className={t.packCopy}
                    disabled={pending !== null}
                    aria-label={`${pack.name} 선택`}
                    onClick={() => {
                      setSelectedId(pack.id);
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    <strong>{pack.name}</strong>
                    <span className={figma.caption}>
                      {pack.description || "앱에 포함된 대화팩"}
                    </span>
                  </button>
                  <Switch
                    aria-label={`${pack.name} 사용`}
                    checked
                    disabled={pending !== null}
                    onChange={() => void run(pack, false)}
                  />
                </div>
              ))}
          </div>
          {packs && !packs.some((pack) => pack.installed) && (
            <p className={figma.caption}>설치한 대화팩이 없어요.</p>
          )}
        </section>
        <section className={figma.section}>
          <h2 className={figma.sectionTitle}>더 받을 수 있는 대화팩</h2>
          <div className={figma.group}>
            {packs
              ?.filter((pack) => !pack.installed)
              .map((pack) => (
                <SettingControlRow
                  key={pack.id}
                  className={figma.row}
                  title={
                    <button
                      type="button"
                      className={t.packCopy}
                      disabled={pending !== null}
                      aria-label={`${pack.name} 선택`}
                      onClick={() => {
                        setSelectedId(pack.id);
                        setError(null);
                        setNotice(null);
                      }}
                    >
                      {pack.name}
                    </button>
                  }
                  description={pack.description}
                  control={
                    <Button
                      variant="ghost"
                      size="small"
                      aria-label={`${pack.name} 설치`}
                      disabled={pending !== null || !pack.bundled}
                      onClick={() => void run(pack, true)}
                    >
                      <ImportIcon size={15} />
                      {pending === pack.id ? "설치 중…" : "설치"}
                    </Button>
                  }
                />
              ))}
          </div>
          <p className={figma.caption}>설치하면 잠시 뒤에 대사가 반영돼요.</p>
        </section>
        <section className={figma.section} aria-label="나만의 대본">
          <h2 className={figma.sectionTitle}>나만의 대본</h2>
          <div className={figma.group}>
            <SettingControlRow
              className={figma.row}
              title="대본 편집기"
              description="원문 작성·검사·저장은 별도 talk editor에서 해요. 유효하게 저장된 파일은 실행 중 자동으로 다시 읽어요."
              control={<span className={figma.caption}>talk/index.talk</span>}
            />
          </div>
        </section>
        {packs === null && !error && <p role="status">대화팩 목록을 읽고 있어요.</p>}
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
      </div>
    </section>
  );
}
