import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, Dialog, FormField, Select, TextInput } from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
import { number, rows, text, type DataRecord, type ToolAction } from "../toolData";
import { focusDuration } from "./FocusTimerData";
import * as s from "./FocusTimer.css";

export function FocusTimerQueue({
  data,
  tasks,
  act,
  defaultMinutes,
  revision,
  onDirtyChange,
}: {
  data: DataRecord;
  tasks: DataRecord[];
  act: ToolAction;
  defaultMinutes: string;
  revision: number;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const queue = rows(data.queue);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [todoId, setTodoId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"clear" | "cycle" | null>(null);
  const [moveTick, setMoveTick] = useState(0);
  const moves = useRef<DataRecord[]>([]);
  const moveRevision = useRef<number | null>(null);
  const actRef = useRef(act);
  actRef.current = act;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const lock = useRef(false);
  const dragged = useRef("");
  const duration = Number(minutes) * 60000;
  const valid =
    title.trim() && Number.isFinite(duration) && duration >= 1000 && duration <= 86400000;

  useEffect(() => { onDirtyChange?.(title.length > 0); }, [title, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (lock.current || moves.current.length === 0 || (moveRevision.current !== null && revision <= moveRevision.current)) return;
    const input = moves.current.shift();
    if (!input) return;
    const from = queueRef.current.findIndex((item) => item.id === input.id);
    const to = input.targetId
      ? queueRef.current.findIndex((item) => item.id === input.targetId)
      : input.direction === "up" ? Math.max(0, from - 1) : Math.min(queueRef.current.length - 1, from + 1);
    if (from < 0 || to < 0 || from === to) {
      setMoveTick((tick) => tick + 1);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        if (!(await actRef.current("queue-move", input))) {
          moves.current = [];
          setError("다음 집중을 저장하지 못했어요. 다시 시도해 주세요.");
        } else {
          moveRevision.current = revision;
        }
      } catch (cause: unknown) {
        moves.current = [];
        setError(errorText(cause));
      } finally {
        lock.current = false;
        setBusy(false);
        setMoveTick((tick) => tick + 1);
      }
    })();
  }, [revision, moveTick]);

  function move(input: DataRecord): void {
    moves.current.push(input);
    setMoveTick((tick) => tick + 1);
  }

  async function action(name: string, input: DataRecord = {}): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const ok = await act(name, input);
      if (!ok) setError("다음 집중을 저장하지 못했어요. 다시 시도해 주세요.");
      else moveRevision.current = revision;
      return ok;
    } catch (cause: unknown) {
      setError(errorText(cause));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
      setMoveTick((tick) => tick + 1);
    }
  }
  async function add(): Promise<void> {
    if (!valid || queue.length >= 8) return;
    if (
      await action("queue-add", {
        title: title.trim(),
        focusDurationMs: Math.round(duration),
        todoId: todoId || null,
      })
    ) {
      setTitle("");
      setTodoId("");
    }
  }
  return (
    <section className={s.recordsPanel} aria-label="다음 집중">
      <div className={s.pane}>
        <div className={s.heading}>
          <h2 className={s.headingText}>다음 집중 · {queue.length}/8</h2>
          <Button
            variant="ghost"
            size="small"
            disabled={busy || queue.length === 0}
            onClick={() => queue.length >= 2 ? setConfirmation("clear") : void action("queue-clear")}
          >
            큐 비우기
          </Button>
        </div>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {(busy || moves.current.length > 0) && <p role="status" className={s.quiet}>다음 집중을 저장하고 있어요.</p>}
        {queue.length === 0 ? (
          <p className={s.quiet}>다음 집중을 추가해 보세요.</p>
        ) : (
          <ol>
            {queue.map((item, index) => {
              const id = text(item.id);
              return (
                <li
                  key={id}
                  className={s.item}
                  draggable={!busy}
                  onDragStart={(event) => {
                    dragged.current = id;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", id);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragged.current && dragged.current !== id)
                      move({ id: dragged.current, targetId: id });
                    dragged.current = "";
                  }}
                  onDragEnd={() => {
                    dragged.current = "";
                  }}
                  onKeyDown={(event) => {
                    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                      event.preventDefault();
                      move({
                        id,
                        direction: event.key === "ArrowUp" ? "up" : "down",
                      });
                    }
                  }}
                  tabIndex={0}
                  aria-label={`${text(item.title)}, ${focusDuration(number(item.focusDurationMs))}. Alt와 위아래 화살표로 순서 변경`}
                >
                  <span className={s.grow}>
                    {index + 1}. {text(item.title)} · {focusDuration(number(item.focusDurationMs))}
                  </span>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy}
                    aria-label={`${text(item.title)} 삭제`}
                    onClick={() => void action("queue-remove", { id })}
                  >
                    삭제
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
        <FormField label="다음 집중 제목">
          <TextInput
            fill
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField label="집중 시간 (분)">
          <TextInput
            fill
            type="number"
            min="0.02"
            max="1440"
            step="0.01"
            value={minutes}
            disabled={busy}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </FormField>
        <FormField label="다음 집중에 연결할 할 일">
          <Select
            fill
            value={todoId}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value;
              setTodoId(id);
              const task = tasks.find((item) => item.id === id);
              if (task) setTitle(text(task.title));
            }}
          >
            <option value="">연결하지 않음</option>
            {tasks.map((task) => (
              <option key={text(task.id)} value={text(task.id)}>
                {text(task.title)}
              </option>
            ))}
          </Select>
        </FormField>
        <Button disabled={busy || !valid || queue.length >= 8} onClick={() => void add()}>
          다음 집중에 추가
        </Button>
      </div>
      <div className={s.pane}>
        <p className={s.quiet}>완료한 집중 {number(data.cycle)}회</p>
        <Button variant="ghost" size="small" disabled={busy || number(data.cycle) === 0} onClick={() => setConfirmation("cycle")}>
          회차 초기화
        </Button>
      </div>
      <Dialog
        isOpen={confirmation !== null}
        title={confirmation === "clear" ? "다음 집중을 모두 비울까요?" : "회차를 초기화할까요?"}
        variant="confirm"
        onOpenChange={(open) => { if (!open) setConfirmation(null); }}
        footer={<><Button variant="ghost" onClick={() => setConfirmation(null)}>취소</Button><Button variant="danger" onClick={() => { const current = confirmation; setConfirmation(null); if (current) void action(current === "clear" ? "queue-clear" : "reset-cycle"); }}>{confirmation === "clear" ? "큐 비우기" : "회차 초기화"}</Button></>}
      >
        <p>{confirmation === "clear" ? "기다리는 다음 집중이 모두 삭제돼요." : "완료한 집중 회차가 0으로 돌아가요."}</p>
      </Dialog>
    </section>
  );
}
