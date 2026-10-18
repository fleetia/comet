import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "@comet/icon";
import {
  Balloon,
  Button,
  CharacterArtwork,
  FormField,
  IconButton as CometIconButton,
  Select,
  Surface,
  TextInput,
} from "@comet/ui";
import type { WidgetView } from "../types";
import { isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { transparentDocument } from "../../components/companion.css";
import { number, record, text, type DataRecord, type ToolAction } from "../toolData";
import type { CharacterCollection } from "../../types";
import { activeTargets } from "../../components/Launcher/search";
import { FriendArtwork } from "../../components/CharacterManager/FriendsLibrary";
import diceThree from "./assets/dice-three.svg";
import diceFive from "./assets/dice-five.svg";
import { ToyArtwork } from "../../components/DesktopToy/ToyArtwork";
import planeTrail from "./assets/toy-plane-trail.svg";
import ballTrail from "./assets/toy-ball-trail.svg";
import * as toy from "./toyTools.css";
import * as s from "../tools.css";
import * as c from "../../common.css";

type Props = {
  widget: WidgetView;
  act: ToolAction;
  characters?: CharacterCollection;
  widgets?: WidgetView[];
  userName?: string;
};

function MotionTool({ widget, act, widgets = [widget] }: Props): ReactElement {
  return (
    <section className={toy.toys} aria-label="장난감">
      <Surface variant="sheet" className={toy.toyScene}>
        <img src={planeTrail} alt="" className={toy.trail} />
        <img src={ballTrail} alt="" className={toy.trail} />
        <span className={toy.planeLabel}>종이비행기 · 끌어서 날려요</span>
        <span className={toy.bubbleLabel}>비눗방울 · 톡 터뜨려요</span>
        <span className={toy.ballLabel}>공 · 튀기며 굴러가요</span>
        {(["paper-plane", "ball", "bubbles"] as const).map((kind) => {
          const target = widgets.find(
            (item) => item.kind === kind && item.installed && item.enabled,
          );
          const name = kind === "paper-plane" ? "종이비행기" : kind === "ball" ? "공" : "비눗방울";
          return (
            <button
              key={kind}
              type="button"
              className={toy.launchToy}
              aria-label={kind === widget.kind ? "바탕화면에 꺼내기" : `${name} 바탕화면에 꺼내기`}
              title={target ? `${name} 꺼내기` : `${name} 위젯을 설치하고 켜 주세요`}
              disabled={!target}
              style={{
                left: kind === "paper-plane" ? 214 : kind === "ball" ? 92 : 196,
                top: kind === "paper-plane" ? 44 : kind === "ball" ? 196 : 128,
                transform: kind === "paper-plane" ? "rotate(-12deg)" : undefined,
              }}
              onClick={() => {
                if (target) void act("desktop-open", {}, target);
              }}
            >
              <ToyArtwork kind={kind} bubbleSize={34} />
              {kind === "bubbles" && (
                <>
                  <span className={toy.smallBubble}>
                    <ToyArtwork kind="bubbles" bubbleSize={18} bubbleColor={1} />
                  </span>
                  <span className={toy.tinyBubble}>
                    <ToyArtwork kind="bubbles" bubbleSize={12} bubbleColor={2} />
                  </span>
                </>
              )}
            </button>
          );
        })}
      </Surface>
      <div className={toy.toyFooter}>
        <span>끌어서 놓기 · 우클릭으로 정리</span>
        <Button variant="link" size="small" onClick={() => void act("desktop-clear")}>
          정리하기
        </Button>
      </div>
    </section>
  );
}

function InteractionTool({ widget, act, characters }: Props): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const targets = characters ? activeTargets(characters) : [];
  const selected = targets.find((item) => item.id === selectedId) ?? targets[0];
  const data = record(widget.data);
  const character = characters?.installed.find((item) => item.id === selected?.id);
  return (
    <section className={toy.card} aria-label="캐릭터 교감">
      <header className={toy.header}>
        <Icon name="heart" size={16} className={toy.icon} />
        <h2 className={toy.heading}>캐릭터 교감</h2>
        <span className={toy.characterField}>
          <Select
            className={toy.characterSelect}
            aria-label="함께할 캐릭터"
            value={selected?.token ?? ""}
            disabled={!selected}
            onChange={(event) =>
              setSelectedId(targets.find((item) => item.token === event.target.value)?.id ?? null)
            }
          >
            {targets.length === 0 && (
              <option value="">
                {characters ? "함께 지내는 캐릭터가 없어요" : "캐릭터를 불러오는 중…"}
              </option>
            )}
            {targets.map((character) => (
              <option key={character.id} value={character.token}>
                {character.token} · {character.name}
              </option>
            ))}
          </Select>
        </span>
      </header>
      <div className={toy.metrics}>
        <div className={toy.portrait} aria-hidden="true">
          {character ? (
            <FriendArtwork character={character} compact />
          ) : (
            <CharacterArtwork size="conversation" />
          )}
        </div>
        <div className={toy.counters}>
          <div className={toy.counter}>
            <span className={toy.caption}>남은 간식</span>
            <strong className={toy.value}>{number(data.snacks)}조각</strong>
          </div>
          <div className={toy.counter}>
            <span className={toy.caption}>함께한 손길</span>
            <strong className={toy.value}>{number(data.touches)}번</strong>
          </div>
        </div>
      </div>
      <div className={toy.actions}>
        {[
          ["stroke", "쓰다듬기", "쓰다듬기", "pet"],
          ["poke", "콕 찌르기", "콕", "poke"],
          ["snack", "간식 나누기", "간식", "cookie"],
        ].map(([action, label, visible, icon]) => (
          <Button
            key={action}
            aria-label={label}
            variant={action === "snack" ? "primary" : "ghost"}
            size="small"
            leadingIcon={<Icon name={icon as "pet" | "poke" | "cookie"} size={15} />}
            disabled={!selected || (action === "snack" && number(data.snacks) === 0)}
            onClick={() => {
              if (selected) void act(action, { character: selected.token, owner: selected.id });
            }}
          >
            {visible}
          </Button>
        ))}
      </div>
      <Button
        className={toy.refill}
        variant="link"
        size="small"
        aria-label="간식 채우기"
        onClick={() => void act("refill")}
      >
        간식 채우기…
      </Button>
    </section>
  );
}

function Die({ value, label }: { value: string; label: string }): ReactElement {
  const asset = value === "3" ? diceThree : value === "5" ? diceFive : null;
  return (
    <span className={toy.die}>
      {asset ? (
        <img src={asset} alt="" />
      ) : (
        <span className={toy.dieValue} aria-hidden="true">
          {value || "—"}
        </span>
      )}
      <span className={toy.caption}>
        {label} {value || "—"}
      </span>
    </span>
  );
}

type PlayKind = "dice" | "coin" | "rps";
const playNames: Record<PlayKind, string> = {
  dice: "주사위 놀이",
  coin: "동전 던지기",
  rps: "가위바위보 놀이",
};

function PlayCompanion({
  characters,
  face,
  owner,
}: {
  characters?: CharacterCollection;
  face: string;
  owner?: string;
}): ReactElement {
  const character = characters?.installed.find(
    (item) => item.id === (owner ?? characters.active[0]),
  );
  return (
    <div className={toy.companion} aria-hidden="true">
      {character ? (
        <FriendArtwork character={character} />
      ) : (
        <CharacterArtwork className={toy.playFace} face={face} size="large" />
      )}
    </div>
  );
}

function SmallMatchTool({ widget, act, characters, userName }: Props): ReactElement {
  const data = record(widget.data);
  const stored = text(data.game);
  const inferred: PlayKind = /^[1-6]$/.test(text(data.a))
    ? "dice"
    : ["heads", "tails"].includes(text(data.a))
      ? "coin"
      : "rps";
  const savedGame: PlayKind =
    stored === "dice" || stored === "coin" || stored === "rps" ? stored : inferred;
  const [game, setGame] = useState<PlayKind | null>(text(data.result) || stored ? savedGame : null);
  const targets = characters ? activeTargets(characters) : [];
  const [owner, setOwner] = useState<string | null>(null);
  const selected = targets.find((target) => target.id === owner) ?? targets[0];
  const name = selected?.name ?? "작은 승부";
  const target: DataRecord = selected ? { character: selected.token, owner: selected.id } : {};
  const a = game === savedGame ? text(data.a) : "";
  const b = game === savedGame ? text(data.b) : "";
  const result = game === savedGame ? text(data.result) : "";
  return (
    <section className={toy.play} aria-label="같이 놀기">
      <div className={toy.playHeader}>
        <span className={toy.playTarget}>
          <Select
            aria-label="함께할 캐릭터"
            value={selected?.id ?? ""}
            disabled={!selected}
            onChange={(event) => setOwner(event.currentTarget.value)}
          >
            {!selected && (
              <option value="">
                {characters ? "함께 지내는 캐릭터가 없어요" : "친구를 불러오는 중…"}
              </option>
            )}
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </Select>
        </span>
        <Button variant="link" size="small" onClick={() => setGame(null)}>
          같이 놀기
        </Button>
      </div>
      {game ? (
        <>
          <Balloon
            className={toy.balloon}
            speaker="nadir"
            speakerName={name}
            content="actions"
            actions={
              game === "dice" ? (
                <div className={toy.gameActions}>
                  {result && (
                    <Button size="small" variant="ghost" onClick={() => setGame(null)}>
                      그만
                    </Button>
                  )}
                  <Button
                    size="small"
                    aria-label="주사위 굴리기"
                    onClick={() => void act("dice", target)}
                  >
                    {result ? "한 판 더" : "주사위 굴리기"}
                  </Button>
                </div>
              ) : (
                <div className={toy.actions}>
                  {(game === "coin"
                    ? [
                        ["heads", "앞면"],
                        ["tails", "뒷면"],
                      ]
                    : [
                        ["scissors", "가위"],
                        ["rock", "바위"],
                        ["paper", "보"],
                      ]
                  ).map(([choice, label]) => (
                    <Button
                      key={choice}
                      size="small"
                      variant={a === choice ? "selected" : "ghost"}
                      onClick={() => void act(game, { choice, ...target })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )
            }
          >
            {game === "dice" ? (
              <>
                주사위 한 판이에요.
                <div className={toy.dice}>
                  <Die value={a} label={userName || "여행자"} />
                  <span className={toy.caption}>vs</span>
                  <Die value={b} label={name} />
                </div>
              </>
            ) : game === "coin" ? (
              "앞면? 뒷면? 골라 봐요."
            ) : (
              "가위바위보!"
            )}
            {result && (
              <p className={toy.result} role="status">
                {result}
              </p>
            )}
          </Balloon>
          <PlayCompanion
            characters={characters}
            owner={selected?.id}
            face={game === "dice" ? "(^‿^)" : game === "coin" ? "(¬‿¬)" : "(・o・)"}
          />
        </>
      ) : (
        <>
          <div className={toy.orbit} aria-label="놀이 고르기">
            <span className={toy.orbitLine} aria-hidden="true" />
            <span className={toy.orbitCore}>
              <Icon name="together" size={22} />
              <span>같이 놀기</span>
            </span>
            {(["dice", "coin", "rps"] as const).map((kind, index) => (
              <button
                type="button"
                className={toy.orbitChoice}
                key={kind}
                style={{ left: [24, 115, 204][index], top: [96, 28, 96][index] }}
                onClick={() => setGame(kind)}
              >
                <Icon
                  name={kind === "dice" ? "dice" : kind === "coin" ? "coin" : "scissors"}
                  size={18}
                />
                <span>{playNames[kind]}</span>
              </button>
            ))}
          </div>
          <PlayCompanion characters={characters} owner={selected?.id} face="(・ᴗ・)" />
        </>
      )}
    </section>
  );
}

export function CompanionTool({
  onClose,
  busy = false,
  error,
  ...props
}: Props & { onClose: () => Promise<void>; busy?: boolean; error?: string | null }): ReactElement {
  const [failure, setFailure] = useState<string | null>(null);
  const drag = useWindowDrag(isDesktop(), setFailure);
  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    return () => document.documentElement.classList.remove(transparentDocument);
  }, []);
  return (
    <main
      className={toy.native}
      onPointerDown={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest("button, select, input, a"))
          drag.onPointerDown(event);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.reset}
      onPointerCancel={drag.reset}
    >
      <CometIconButton
        className={toy.close}
        icon="close"
        aria-label="위젯 닫기"
        onClick={() => void onClose().catch((cause: unknown) => setFailure(String(cause)))}
      />
      <fieldset className={toy.nativeBody} disabled={busy}>
        <ToyTool {...props} />
      </fieldset>
      {(error || failure) && (
        <p className={toy.error} role="alert">
          {error || failure}
        </p>
      )}
    </main>
  );
}

export function ToyTool({ widget, act, characters, widgets, userName }: Props): ReactElement {
  const d = record(widget.data);
  const [guess, setGuess] = useState("50");
  const [mode, setMode] = useState(text(d.mode) === "number" ? "number" : "cups");
  const [fortuneOwner, setFortuneOwner] = useState<string | null>(null);
  switch (widget.kind) {
    case "ball":
    case "paper-plane":
    case "bubbles":
    case "pet":
      return <MotionTool widget={widget} act={act} widgets={widgets} />;
    case "interaction":
      return <InteractionTool widget={widget} act={act} characters={characters} />;
    case "small-match":
      return (
        <SmallMatchTool widget={widget} act={act} characters={characters} userName={userName} />
      );
    case "guessing":
      return (
        <>
          <FormField className={c.field} label="놀이">
            <Select
              fill
              value={mode}
              disabled={d.playing === true}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="cups">컵 찾기</option>
              <option value="number">숫자 맞히기 (1–100)</option>
            </Select>
          </FormField>
          <Button variant="ghost" onClick={() => void act("start", { mode })}>
            새 놀이 시작
          </Button>
          <p role="status">{text(d.hint) || "새 놀이를 시작해 주세요."}</p>
          {d.playing === true &&
            (text(d.mode) === "cups" ? (
              <div className={s.row}>
                {[1, 2, 3].map((value) => (
                  <Button
                    variant="primary"
                    key={value}
                    onClick={() => void act("guess", { value })}
                  >
                    {value}번 컵
                  </Button>
                ))}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("guess", { value: Number(guess) });
                }}
              >
                <FormField className={c.field} label="예상 숫자" required>
                  <TextInput
                    fill
                    type="number"
                    min="1"
                    max="100"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="primary">
                  맞혀 보기
                </Button>
              </form>
            ))}
          <p className={c.quiet}>시도 {number(d.attempts)}번</p>
        </>
      );
    case "fishing":
      return (
        <>
          <div className={s.number} aria-hidden="true">
            🎣
          </div>
          <p role="status">
            {text(d.phase) === "bite"
              ? "입질이에요! 지금 거둬 보세요."
              : text(d.phase) === "waiting"
                ? "입질을 기다리고 있어요."
                : "낚싯줄을 던져 보세요."}
          </p>
          <Button
            variant="primary"
            onClick={() => void act(text(d.phase) === "idle" ? "cast" : "reel")}
          >
            {text(d.phase) === "idle" ? "낚싯줄 던지기" : "낚싯줄 거두기"}
          </Button>
          <p>
            최근 획득: {text(d.lastCatch) || "아직 없어요"} · 총 {number(d.catches)}번
          </p>
        </>
      );
    case "fortune": {
      const hasDrawn =
        typeof d.draws === "number" ? d.draws > 0 : text(d.text) !== "가상 장난 운세입니다.";
      const targets = characters ? activeTargets(characters) : [];
      const selected = targets.find((target) => target.id === fortuneOwner) ?? targets[0];
      const name = selected?.name;
      return (
        <div className={toy.games}>
          <section className={toy.game} aria-label="장난 운세">
            <div className={toy.playHeader}>
              <span className={toy.playTarget}>
                <Select
                  aria-label="함께할 캐릭터"
                  value={selected?.id ?? ""}
                  disabled={!selected}
                  onChange={(event) => setFortuneOwner(event.currentTarget.value)}
                >
                  {targets.length === 0 && (
                    <option value="">
                      {characters ? "함께 지내는 캐릭터가 없어요" : "친구를 불러오는 중…"}
                    </option>
                  )}
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </Select>
              </span>
              <span>장난 운세</span>
              <CometIconButton
                className={toy.fortuneDraw}
                icon="redo"
                aria-label="운세 뽑기"
                onClick={() =>
                  void act(
                    "draw",
                    selected ? { character: selected.token, owner: selected.id } : {},
                  )
                }
              />
            </div>
            <Balloon
              className={toy.fortuneBalloon}
              speaker="nadir"
              speakerName={name ?? "장난 운세"}
            >
              <div className={toy.fortuneCopy}>
                <p className={toy.fortuneIntro}>오늘의 장난 운세예요.</p>
                <div className={toy.fortune}>
                  <Icon name="crystal" size={18} className={toy.fortuneIcon} />
                  <p className={toy.fortuneText} role="status">
                    {(hasDrawn && text(d.text)) || "운세를 뽑으면 여기에 보여요."}
                  </p>
                </div>
                <p className={toy.fortuneNote}>재미로 보는 가상의 운세예요</p>
              </div>
            </Balloon>
            <PlayCompanion characters={characters} owner={selected?.id} face="(¬‿¬)" />
          </section>
        </div>
      );
    }
    case "plant":
      return (
        <>
          <div className={s.number} aria-hidden="true">
            {["🪴", "🌱", "🌿", "🌸"][number(d.stage)]}
          </div>
          <p role="status">
            {["씨앗", "새싹", "잎", "꽃"][number(d.stage)]} · 남은 물 {number(d.water)}
          </p>
          <p className={c.quiet}>물이 있으면 1분마다 한 단계 자라요.</p>
          <Button
            variant="primary"
            disabled={number(d.water) >= 3 || number(d.stage) >= 3}
            onClick={() => void act("water")}
          >
            물 주기
          </Button>
        </>
      );
    default:
      return <p>지원하는 놀이를 선택해 주세요.</p>;
  }
}
