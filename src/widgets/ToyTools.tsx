import { FormField, Button, Select, TextField } from "@fleetia/lagrange";
import { useRef, useState, type PointerEvent, type ReactElement } from "react";
import type { WidgetView } from "./types";
import { number, record, rows, text, type ToolAction } from "./toolData";
import * as s from "./tools.css";
import * as c from "../lagrange.css";

type Props = { widget: WidgetView; act: ToolAction };
function point(event: PointerEvent<HTMLElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
  };
}
export function MotionTool({ widget, act }: Props): ReactElement {
  const data = record(widget.data);
  const start = useRef<{ x: number; y: number } | null>(null);
  const plane = widget.kind === "paper-plane";
  return (
    <>
      <p className={c.quiet}>
        안에서 누르고 원하는 방향으로 끌어 놓으세요. 키보드로도 날릴 수 있어요.
      </p>
      <div
        className={s.area}
        aria-label={plane ? "종이비행기 비행 공간" : "공 놀이 공간"}
        onPointerDown={(event) => {
          start.current = point(event);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onPointerUp={(event) => {
          const from = start.current;
          start.current = null;
          if (!from) {
            return;
          }
          const to = point(event);
          const vx = Math.max(-100, Math.min(100, (to.x - from.x) * 2));
          const vy = Math.max(-100, Math.min(100, (to.y - from.y) * 2));
          if (Math.hypot(vx, vy) >= 1) {
            void act(plane ? "launch" : "throw", { ...from, vx, vy });
          }
        }}
      >
        <span
          className={s.token}
          style={{
            left: `${number(data.x)}%`,
            top: `${number(data.y)}%`,
            transition: data.moving || data.flying ? undefined : "none",
          }}
        >
          {plane ? "✈" : "●"}
        </span>
      </div>
      <div className={s.row}>
        <Button
          variant="primary"
          onClick={() => void act(plane ? "launch" : "throw", { x: 20, y: 60, vx: 40, vy: -25 })}
        >
          {plane ? "오른쪽으로 날리기" : "오른쪽으로 던지기"}
        </Button>
        {!plane && (
          <Button variant="secondary" onClick={() => void act("stop")}>
            멈추기
          </Button>
        )}
      </div>
      <p role="status" className={c.quiet}>
        {plane
          ? `비행 거리 ${number(data.distance).toFixed(1)} · 최고 ${number(data.best).toFixed(1)}`
          : `튕긴 횟수 ${number(data.bounces)} · ${data.moving ? "움직이는 중" : "멈춤"}`}
      </p>
    </>
  );
}
export function ToyTool({ widget, act }: Props): ReactElement {
  const d = record(widget.data);
  const [character, setCharacter] = useState("A");
  const [guess, setGuess] = useState("50");
  const [mode, setMode] = useState(text(d.mode) === "number" ? "number" : "cups");
  const [decoration, setDecoration] = useState<number | null>(null);
  switch (widget.kind) {
    case "ball":
    case "paper-plane":
      return <MotionTool widget={widget} act={act} />;
    case "interaction":
      return (
        <>
          <FormField className={c.field} label="함께할 캐릭터">
            <Select value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option>A</option>
              <option>B</option>
            </Select>
          </FormField>
          <p>남은 간식 {number(d.snacks)}조각</p>
          <div className={s.row}>
            {[
              ["stroke", "쓰다듬기"],
              ["poke", "콕 찌르기"],
              ["snack", "간식 나누기"],
            ].map(([action, label]) => (
              <Button
                key={action}
                variant="secondary"
                disabled={action === "snack" && number(d.snacks) === 0}
                onClick={() => void act(action, { character })}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void act("refill")}>
            간식 채우기
          </Button>
          <p className={c.quiet}>함께한 손길 {number(d.touches)}번</p>
        </>
      );
    case "bubbles":
      return (
        <>
          <div className={s.area}>
            {rows(d.bubbles).map((bubble) => (
              <button
                key={number(bubble.id)}
                className={s.bubble}
                style={{ left: `${number(bubble.x)}%`, top: `${number(bubble.y)}%` }}
                aria-label={`비눗방울 ${number(bubble.id)} 터뜨리기`}
                onClick={() => void act("pop", { id: number(bubble.id) })}
              />
            ))}
          </div>
          <p role="status">
            연속 {number(d.streak)}개 · 최고 {number(d.best)}개
          </p>
          <div className={s.row}>
            <Button
              variant="primary"
              disabled={rows(d.bubbles).length >= 30}
              onClick={() => void act("make")}
            >
              방울 만들기
            </Button>
            <Button variant="secondary" onClick={() => void act("reset")}>
              새로 시작
            </Button>
          </div>
        </>
      );
    case "small-match":
      return (
        <>
          <p className={s.number}>
            {text(d.a)} {text(d.b) && "/"} {text(d.b)}
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
          <p role="status">{text(d.hint)}</p>
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
    case "fortune":
      return (
        <>
          <p className={c.quiet}>재미로 보는 가상의 장난 운세입니다.</p>
          <p className={s.prose} role="status">
            {text(d.text)}
          </p>
          <Button variant="primary" onClick={() => void act("draw")}>
            운세 뽑기
          </Button>
        </>
      );
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
    case "pet":
      return (
        <>
          <p className={c.quiet}>먹이를 놓을 곳을 눌러 주세요.</p>
          <div className={s.area} onPointerUp={(event) => void act("feed", point(event))}>
            <span className={s.token} style={{ left: `${number(d.x)}%`, top: `${number(d.y)}%` }}>
              🐌
            </span>
            {d.food && (
              <span
                className={s.token}
                style={{
                  left: `${number(record(d.food).x)}%`,
                  top: `${number(record(d.food).y)}%`,
                }}
              >
                🥬
              </span>
            )}
          </div>
          <Button variant="secondary" onClick={() => void act("feed", { x: 80, y: 50 })}>
            오른쪽에 먹이 놓기
          </Button>
          <p role="status">먹이에 도착한 횟수 {number(d.arrivals)}</p>
        </>
      );
    case "collection":
      return (
        <>
          <p className={c.quiet}>
            실제로 획득한 물건만 꺼낼 수 있어요. 소품을 고른 뒤 공간을 누르면 옮겨요.
          </p>
          <div
            className={s.area}
            onPointerUp={(event) => {
              if (decoration !== null) {
                void act("move", { id: decoration, ...point(event) });
              }
            }}
          >
            {rows(d.decorations).map((item) => (
              <button
                className={s.token}
                key={number(item.id)}
                aria-label={`${text(rows(d.items).find((owned) => owned.itemId === item.itemId)?.name) || "이름 없는 소품"} 소품 선택`}
                aria-pressed={decoration === number(item.id)}
                style={{ left: `${number(item.x)}%`, top: `${number(item.y)}%` }}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={() => setDecoration(number(item.id))}
              >
                ◆
              </button>
            ))}
          </div>
          {rows(d.items).length === 0 && (
            <p>아직 모은 물건이 없어요. 낚시에서 획득하면 여기에 모입니다.</p>
          )}
          {rows(d.items).map((item) => (
            <div key={text(item.itemId)} className={s.item}>
              <span>
                {text(item.name)} × {number(item.quantity)}
              </span>
              <Button
                variant="secondary"
                disabled={
                  rows(d.decorations).filter((x) => x.itemId === item.itemId).length >=
                  number(item.quantity)
                }
                onClick={() => void act("decorate", { itemId: text(item.itemId), x: 50, y: 50 })}
              >
                꺼내 놓기
              </Button>
            </div>
          ))}
          {decoration !== null && (
            <Button
              variant="secondary"
              onClick={() => void act("move", { id: decoration, x: 50, y: 50 })}
            >
              선택한 소품 가운데로
            </Button>
          )}
          <Button variant="secondary" onClick={() => void act("clear")}>
            소품 모두 넣기
          </Button>
        </>
      );
    default:
      return <p>지원하는 놀이를 선택해 주세요.</p>;
  }
}
