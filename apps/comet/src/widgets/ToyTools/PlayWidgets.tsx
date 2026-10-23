import { useState, type ReactElement } from "react";
import { Icon, type IconName } from "@comet/icon";
import { Balloon, Button, TextInput } from "@comet/ui";
import type { WidgetView } from "../types";
import { number, record, text, type ToolAction } from "../toolData";
import type { CharacterCollection } from "../../types";
import { activeTargets } from "../../components/Launcher/search";
import { ToyArtwork } from "../../components/DesktopToy/ToyArtwork";
import waitingLine from "./assets/fishing-waiting.svg";
import biteLine from "./assets/fishing-bite.svg";
import * as toy from "./toyTools.css";
import * as s from "./playWidgets.css";

type Props = { widget: WidgetView; act: ToolAction };

/** Keep ids in sync with `FISHING_CATCHES` in `widgets/toys.rs`. */
const CATCHES: { id: string; name: string; icon: IconName }[] = [
  { id: "shell", name: "조개껍데기", icon: "shell" },
  { id: "conch", name: "작은 소라", icon: "conch" },
  { id: "glass-marble", name: "유리구슬", icon: "marble" },
  { id: "fish-blue", name: "파란 물고기", icon: "fish" },
  { id: "fish-gold", name: "금빛 물고기", icon: "fish" },
  { id: "stone", name: "동그란 돌", icon: "marble" },
];

/** Picks 을/를 from whether the last Hangul syllable has a final consonant. */
function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 0 ? "를" : "을";
}

function Card({
  icon,
  title,
  meta,
  children,
}: {
  icon: IconName;
  title: string;
  meta?: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <section className={toy.card} aria-label={title}>
      <header className={toy.header}>
        <Icon name={icon} size={15} className={toy.icon} />
        <h2 className={toy.heading}>{title}</h2>
        {meta && <span className={s.meta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

export function FishingTool({ widget, act }: Props): ReactElement {
  const d = record(widget.data);
  const phase = text(d.phase);
  const collected = record(d.collected);
  // After reeling in, the card shows what has been gathered so far.
  if (phase === "idle" && number(d.catches) > 0) {
    return (
      <Card icon="fish" title="낚시 · 모은 것" meta={`${number(d.catches)}번 낚았어요`}>
        {text(d.lastCatch) ? (
          <p className={s.headline} role="status">
            {text(d.lastCatch)}
            {objectParticle(text(d.lastCatch))} 낚았어요!
          </p>
        ) : (
          <p className={s.status} role="status">
            이번에는 빈 낚싯줄을 거뒀어요.
          </p>
        )}
        <ul className={s.catches} aria-label="모은 것">
          {CATCHES.map((item) =>
            number(collected[item.id]) > 0 ? (
              <li key={item.id} className={s.catchCell}>
                <Icon name={item.icon} size={16} className={s.catchIcon} />
                <span>{item.name}</span>
                <span className={s.catchCount}>×{number(collected[item.id])}</span>
              </li>
            ) : (
              <li key={item.id} className={s.unknownCell} aria-label="아직 못 잡은 것">
                ?
              </li>
            ),
          )}
        </ul>
        <Button variant="primary" className={s.wide} onClick={() => void act("cast")}>
          낚싯줄 던지기
        </Button>
      </Card>
    );
  }
  const bite = phase === "bite";
  return (
    <Card icon="fish" title="낚시">
      <img src={bite ? biteLine : waitingLine} alt="" className={s.art} />
      <p className={bite ? s.alert : s.status} role="status">
        {bite
          ? "입질이에요! 지금 거둬 보세요."
          : phase === "waiting"
            ? "입질을 기다리고 있어요."
            : "낚싯줄을 던져 보세요."}
      </p>
      <Button
        variant={bite || phase === "idle" ? "primary" : "ghost"}
        className={s.wide}
        onClick={() => void act(phase === "idle" ? "cast" : "reel")}
      >
        {phase === "idle" ? "낚싯줄 던지기" : "낚싯줄 거두기"}
      </Button>
    </Card>
  );
}

const PLANT_STAGES = ["씨앗", "떡잎", "새싹", "꽃"];

/** Figma's potted sprout is stage 2; earlier stages drop parts and the last adds a bloom. */
function PlantArt({ stage }: { stage: number }): ReactElement {
  return (
    <svg width="96" height="86" viewBox="0 0 96 86" fill="none" aria-hidden="true">
      {stage >= 1 && (
        <path
          d={stage === 1 ? "M48 52V42" : "M48 52V30"}
          stroke="#77D9CA"
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}
      {stage === 1 && <path d="M48 44C43 44 39 40 38 35C44 35 48 39 48 44Z" fill="#8FE3D6" />}
      {stage >= 2 && (
        <>
          <path d="M48 38C40 38 33 32 32 22C42 22 48 28 48 38Z" fill="#77D9CA" />
          <path d="M48 32C55 32 62 26 63 17C54 17 48 23 48 32Z" fill="#8FE3D6" />
        </>
      )}
      {stage >= 3 && (
        <>
          {[0, 72, 144, 216, 288].map((angle) => (
            <circle
              key={angle}
              cx={48 + 7 * Math.cos((angle * Math.PI) / 180)}
              cy={20 + 7 * Math.sin((angle * Math.PI) / 180)}
              r="5"
              fill="#FF8BC4"
            />
          ))}
          <circle cx="48" cy="20" r="4" fill="#FFCC33" />
        </>
      )}
      <path d="M24 52H72L66 82H30L24 52Z" fill="#FF9F85" />
      <path d="M22 50H74V57H22V50Z" fill="#FFB8A3" />
    </svg>
  );
}

export function PlantTool({ widget, act }: Props): ReactElement {
  const d = record(widget.data);
  const stage = Math.min(3, number(d.stage));
  const water = Math.min(3, number(d.water));
  return (
    <>
      <Card icon="plant" title="식물" meta={`${PLANT_STAGES[stage]} · ${stage}/3단계`}>
        <div className={s.centered}>
          <PlantArt stage={stage} />
        </div>
        <div className={s.water}>
          <span className={toy.caption}>남은 물</span>
          <span className={s.waterTrack} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span key={index} className={s.waterDrop} data-filled={index < water} />
            ))}
          </span>
          <span className={toy.caption} role="status">
            {water}/3
          </span>
        </div>
        <Button
          variant="primary"
          className={s.wide}
          leadingIcon={<Icon name="water" size={14} />}
          disabled={water >= 3 || stage >= 3}
          onClick={() => void act("water")}
        >
          물 주기
        </Button>
      </Card>
      <span className={s.chip}>
        {stage >= 3 ? "꽃이 피었어요" : "꽃이 피면 친구가 알아봐 줘요"}
      </span>
    </>
  );
}

const ORDINALS = ["첫", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];

export function GuessingTool({
  widget,
  act,
  characters,
}: Props & { characters?: CharacterCollection }): ReactElement {
  const d = record(widget.data);
  const mode = text(d.mode) === "number" ? "number" : "cups";
  const playing = d.playing === true;
  const attempts = number(d.attempts);
  const [guess, setGuess] = useState("");
  const [choosing, setChoosing] = useState(false);
  const selected = characters ? activeTargets(characters)[0] : undefined;
  const name = selected?.name ?? "친구";
  const finished = !playing && attempts > 0;
  const start = (next: "number" | "cups"): void => {
    setGuess("");
    setChoosing(false);
    void act("start", { mode: next });
  };
  const nth = ORDINALS[attempts] ? `${ORDINALS[attempts]} 번째 도전` : `${attempts + 1}번째 도전`;
  if (choosing || (!playing && !finished)) {
    return (
      <Balloon
        className={toy.balloon}
        speaker="nadir"
        speakerName={name}
        content="actions"
        actions={
          <div className={toy.gameActions}>
            <Button size="small" variant="ghost" className={s.wide} onClick={() => start("number")}>
              숫자 맞히기
            </Button>
            <Button size="small" variant="ghost" className={s.wide} onClick={() => start("cups")}>
              컵 찾기
            </Button>
          </div>
        }
      >
        뭐 하고 놀까요?
      </Balloon>
    );
  }
  const prompt =
    mode === "number"
      ? "1부터 100 사이 숫자 하나 골랐어요. 맞혀 볼래요?"
      : "구슬은 몇 번 컵에 있을까요?";
  return (
    <>
      <Balloon
        className={toy.balloon}
        speaker="nadir"
        speakerName={name}
        content="actions"
        actions={
          finished ? (
            <div className={toy.gameActions}>
              <Button
                size="small"
                variant="ghost"
                className={s.wide}
                onClick={() => setChoosing(true)}
              >
                그만
              </Button>
              <Button size="small" className={s.wide} onClick={() => start(mode)}>
                한 판 더
              </Button>
            </div>
          ) : mode === "number" ? (
            <div className={s.guessMeta}>
              <span>{attempts > 0 ? text(d.hint) : "1부터 100까지"}</span>
              <span>{nth}</span>
            </div>
          ) : undefined
        }
      >
        {finished ? (
          <p className={toy.result} role="status">
            {text(d.hint)}
          </p>
        ) : mode === "number" ? (
          <>
            {prompt}
            <form
              className={s.guessForm}
              onSubmit={(event) => {
                event.preventDefault();
                const value = Number(guess);
                if (Number.isInteger(value) && value >= 1 && value <= 100)
                  void act("guess", { value });
              }}
            >
              <TextInput
                type="number"
                min="1"
                max="100"
                inputMode="numeric"
                aria-label="맞혀 볼 숫자"
                value={guess}
                onChange={(event) => setGuess(event.target.value)}
              />
              <Button type="submit" size="small" disabled={!guess}>
                맞혀 보기
              </Button>
            </form>
          </>
        ) : (
          prompt
        )}
      </Balloon>
      {!finished && mode === "cups" && (
        <>
          <div className={s.cups} role="group" aria-label="컵 고르기">
            {[1, 2, 3].map((value) => (
              <button
                key={value}
                type="button"
                className={s.cup}
                onClick={() => void act("guess", { value })}
              >
                <svg width="38" height="34" viewBox="0 0 38 34" aria-hidden="true">
                  <path d="M8 4h22l6 28H2z" fill="#FF9F85" />
                  <path d="M6 1h26v5H6z" fill="#FFB8A3" />
                </svg>
                {value}번
              </button>
            ))}
          </div>
          <span className={s.hintChip} role="status">
            {attempts > 0 ? text(d.hint) : "구슬이 있을 것 같은 컵을 골라 주세요"}
          </span>
        </>
      )}
    </>
  );
}

export function PetTool({ widget, act }: Props): ReactElement {
  return (
    <Card icon="paw" title="작은 펫">
      <div className={s.companionRow}>
        <ToyArtwork kind="pet" />
        <p className={s.status}>바탕화면 아래를 천천히 돌아다녀요.</p>
      </div>
      <Button
        variant="primary"
        className={s.wide}
        onClick={() => void act("desktop-open", {}, widget)}
      >
        바탕화면에 꺼내기
      </Button>
      <span className={s.chip}>끌면 따라오고, 우클릭으로 정리해요</span>
    </Card>
  );
}
