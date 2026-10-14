import { FormField, Button, Select, TextField } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import type { WidgetView } from "../types";
import { number, record, text, type ToolAction } from "../toolData";
import type { CharacterCollection } from "../../types";
import { activeTargets } from "../../components/Launcher/search";
import * as s from "../tools.css";
import * as c from "../../lagrange.css";

type Props = { widget: WidgetView; act: ToolAction; characters?: CharacterCollection };
const matchLabels: Record<string, string> = {
  heads: "앞면",
  tails: "뒷면",
  scissors: "가위",
  rock: "바위",
  paper: "보",
};

function MotionTool({ widget }: { widget: WidgetView }): ReactElement {
  return (
    <>
      <p className={c.quiet}>
        바탕화면에 꺼낸 뒤 직접 잡아 끌어 놓으세요. 화면 가장자리와 다른 창의 보이는 외곽에
        부딪혀요.
      </p>
      {widget.kind === "bubbles" && <p className={c.quiet}>비눗방울을 누르면 터져요.</p>}
      <p className={c.quiet}>꺼낸 장난감은 우클릭으로도 정리할 수 있어요.</p>
    </>
  );
}
function InteractionTool({ widget, act, characters }: Props): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const targets = characters ? activeTargets(characters) : [];
  const selected = targets.find((item) => item.id === selectedId) ?? targets[0];
  const data = record(widget.data);
  return (
    <>
      <FormField className={c.field} label="함께할 캐릭터">
        <Select
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
      </FormField>
      <p>남은 간식 {number(data.snacks)}조각</p>
      <div className={s.row}>
        {[
          ["stroke", "쓰다듬기"],
          ["poke", "콕 찌르기"],
          ["snack", "간식 나누기"],
        ].map(([action, label]) => (
          <Button
            key={action}
            variant="secondary"
            disabled={!selected || (action === "snack" && number(data.snacks) === 0)}
            onClick={() => {
              if (selected) void act(action, { character: selected.token, owner: selected.id });
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <Button variant="secondary" onClick={() => void act("refill")}>
        간식 채우기
      </Button>
      <p className={c.quiet}>함께한 손길 {number(data.touches)}번</p>
    </>
  );
}
export function ToyTool({ widget, act, characters }: Props): ReactElement {
  const d = record(widget.data);
  const [guess, setGuess] = useState("50");
  const [mode, setMode] = useState(text(d.mode) === "number" ? "number" : "cups");
  switch (widget.kind) {
    case "ball":
    case "paper-plane":
    case "bubbles":
    case "pet":
      return <MotionTool widget={widget} />;
    case "interaction":
      return <InteractionTool widget={widget} act={act} characters={characters} />;
    case "small-match":
      return (
        <>
          <p className={s.number}>
            {matchLabels[text(d.a)] ?? text(d.a)} {text(d.b) && "/"}{" "}
            {matchLabels[text(d.b)] ?? text(d.b)}
          </p>
          <p role="status">{text(d.result) || "한 판 해 볼까요?"}</p>
          <Button variant="primary" onClick={() => void act("dice")}>
            주사위 굴리기
          </Button>
          <p>동전의 앞뒤를 골라요.</p>
          <div className={s.row}>
            {[
              ["heads", "앞면"],
              ["tails", "뒷면"],
            ].map(([choice, label]) => (
              <Button variant="secondary" key={choice} onClick={() => void act("coin", { choice })}>
                {label}
              </Button>
            ))}
          </div>
          <p>가위바위보</p>
          <div className={s.row}>
            {[
              ["scissors", "가위"],
              ["rock", "바위"],
              ["paper", "보"],
            ].map(([choice, label]) => (
              <Button variant="secondary" key={choice} onClick={() => void act("rps", { choice })}>
                {label}
              </Button>
            ))}
          </div>
        </>
      );
    case "guessing":
      return (
        <>
          <FormField className={c.field} label="놀이">
            <Select
              value={mode}
              disabled={d.playing === true}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="cups">컵 찾기</option>
              <option value="number">숫자 맞히기 (1–100)</option>
            </Select>
          </FormField>
          <Button variant="secondary" onClick={() => void act("start", { mode })}>
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
                  <TextField
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
      return (
        <>
          <p className={c.quiet}>재미로 보는 가상의 장난 운세입니다.</p>
          <p className={s.prose} role="status">
            {(hasDrawn && text(d.text)) || "운세를 뽑으면 여기에 보여요."}
          </p>
          <Button variant="primary" onClick={() => void act("draw")}>
            운세 뽑기
          </Button>
        </>
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
