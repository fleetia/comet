import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "@comet/icon";
import availableLines from "./assets/constellation-available.svg";
import chosenLines from "./assets/constellation-chosen.svg";
import spark from "./assets/constellation-spark.svg";
import * as styles from "./conversation.css";

export type BalloonProps = HTMLAttributes<HTMLDivElement> & {
  speaker?: "byulkkori" | "nadir" | "moon-rabbit";
  speakerName?: string;
  tail?: "left" | "center" | "right" | "none";
  tailClassName?: string;
  content?: "text" | "actions" | "result" | "typing";
  speechTrigger?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;
  actions?: ReactNode;
  result?: ReactNode;
};

export function Balloon({
  speaker = "byulkkori",
  speakerName,
  tail = "left",
  tailClassName,
  content = "text",
  speechTrigger,
  actions,
  result,
  children,
  className,
  ...props
}: BalloonProps): JSX.Element {
  const names = { byulkkori: "별꼬리", nadir: "나디르", "moon-rabbit": "달토끼" };
  const speechClassName = [styles.speech, content === "typing" && styles.typingSpeech]
    .filter(Boolean)
    .join(" ");
  const speech = (
    <>
      {children}
      {content === "typing" && (
        <span role="status" aria-label="대답을 적고 있어요">
          <span aria-hidden className={styles.caret} />
        </span>
      )}
    </>
  );
  return (
    <div
      {...props}
      className={[
        styles.balloon,
        content !== "text" && styles.balloonContent,
        content === "typing" && styles.balloonTyping,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={[styles.speaker, styles.speakers[speaker]].join(" ")}>
        {speakerName ?? names[speaker]}
      </span>
      {speechTrigger ? (
        <button
          {...speechTrigger}
          type={speechTrigger.type ?? "button"}
          className={[speechClassName, styles.speechTrigger, speechTrigger.className]
            .filter(Boolean)
            .join(" ")}
        >
          {speech}
        </button>
      ) : (
        <div className={speechClassName}>{speech}</div>
      )}
      {actions && <div className={styles.actions}>{actions}</div>}
      {result && <div className={styles.result}>{result}</div>}
      {tail !== "none" && (
        <span
          aria-hidden
          className={[styles.tail, styles.tails[tail], tailClassName].filter(Boolean).join(" ")}
        />
      )}
    </div>
  );
}

export type InputCapsuleProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSend?: (value: string) => void;
  form?: "single" | "multiline" | "large";
  asTextarea?: boolean;
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "defaultValue" | "onChange" | "disabled" | "placeholder" | "aria-label"
  >;
  inputRef?: Ref<HTMLTextAreaElement>;
  sending?: boolean;
  disableInputWhileSending?: boolean;
  sendDisabled?: boolean;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  sendLabel?: string;
  sendSize?: "regular" | "compact";
};

export function InputCapsule({
  value,
  defaultValue = "",
  onValueChange,
  onSend,
  form = "single",
  asTextarea = false,
  textareaProps,
  inputRef,
  sending = false,
  disableInputWhileSending = true,
  sendDisabled = false,
  disabled = false,
  label = "메시지",
  placeholder = "질문 두 개만 골라 줘",
  sendLabel = "보내기",
  sendSize = "regular",
  className,
  ...props
}: InputCapsuleProps): JSX.Element {
  const [draft, setDraft] = useState(defaultValue);
  const current = value ?? draft;
  const isInputDisabled = disabled || (sending && disableInputWhileSending);
  const isSendDisabled = disabled || sendDisabled || sending || !current.trim();
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isSendDisabled) {
      onSend?.(current);
    }
  }
  function change(next: string): void {
    if (value === undefined) {
      setDraft(next);
    }
    onValueChange?.(next);
  }
  return (
    <form
      {...props}
      onSubmit={submit}
      aria-busy={sending || undefined}
      className={[styles.capsule, styles.capsuleForms[form], className].filter(Boolean).join(" ")}
    >
      {asTextarea || form === "multiline" ? (
        <textarea
          {...textareaProps}
          ref={inputRef}
          aria-label={label}
          value={current}
          placeholder={placeholder}
          disabled={isInputDisabled}
          rows={textareaProps?.rows ?? (form === "multiline" ? 2 : 1)}
          onChange={(event) => change(event.currentTarget.value)}
          className={[styles.input, form === "large" && styles.inputLarge, textareaProps?.className]
            .filter(Boolean)
            .join(" ")}
        />
      ) : (
        <input
          aria-label={label}
          value={current}
          placeholder={placeholder}
          disabled={isInputDisabled}
          onChange={(event) => change(event.currentTarget.value)}
          className={[styles.input, form === "large" && styles.inputLarge]
            .filter(Boolean)
            .join(" ")}
        />
      )}
      <button
        type="submit"
        aria-label={sending ? "보내는 중" : sendLabel}
        disabled={isSendDisabled}
        className={[
          styles.send,
          form === "large" && styles.sendLarge,
          sendSize === "compact" && styles.sendCompact,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Icon
          name={sending ? "more" : "send"}
          size={sendSize === "compact" ? 16 : form === "large" ? 20 : 18}
        />
      </button>
    </form>
  );
}

export type ReferenceMemoProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  onOpen?: () => void;
  onReplace?: () => void;
  onRemove?: () => void;
};
export function ReferenceMemo({
  title,
  onOpen,
  onReplace,
  onRemove,
  className,
  ...props
}: ReferenceMemoProps): JSX.Element {
  return (
    <div {...props} className={[styles.memo, className].filter(Boolean).join(" ")}>
      <Icon name="memo" size={16} />
      <span className={styles.memoText}>
        참고 중<span className={styles.memoTitle}>{title}</span>
      </span>
      <button type="button" className={styles.textAction} onClick={onOpen}>
        원문
      </button>
      <button type="button" className={styles.textAction} onClick={onReplace}>
        바꾸기
      </button>
      <button
        type="button"
        className={styles.textAction}
        aria-label="참고 메모 연결 풀기"
        onClick={onRemove}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

export type ConstellationChoiceProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  fading?: boolean;
};
export function ConstellationChoice({
  selected = false,
  fading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ConstellationChoiceProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      disabled={disabled || fading}
      className={[
        styles.choice,
        selected && styles.choiceSelected,
        fading && styles.fading,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img src={spark} alt="" />
      {children}
    </button>
  );
}
export type ConstellationOption = { id: string; label: string; disabled?: boolean };
export type ConstellationChoicesProps = HTMLAttributes<HTMLDivElement> & {
  options: readonly [ConstellationOption, ConstellationOption, ConstellationOption];
  selectedId?: string;
  onChoose?: (id: string) => void;
  label?: string;
};
export function ConstellationChoices({
  options,
  selectedId,
  onChoose,
  label = "이야기 선택",
  className,
  ...props
}: ConstellationChoicesProps): JSX.Element {
  const id = useId();
  const hasSelection = options.some((option) => option.id === selectedId);
  const positions = [
    styles.choicePositions.first,
    styles.choicePositions.second,
    styles.choicePositions.third,
  ];
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      id={props.id ?? id}
      className={[styles.choices, className].filter(Boolean).join(" ")}
    >
      <img src={hasSelection ? chosenLines : availableLines} alt="" className={styles.choiceLine} />
      {options.map((option, index) => (
        <ConstellationChoice
          key={option.id}
          selected={selectedId === option.id}
          fading={hasSelection && selectedId !== option.id}
          disabled={option.disabled}
          className={positions[index]}
          onClick={() => onChoose?.(option.id)}
        >
          {option.label}
        </ConstellationChoice>
      ))}
    </div>
  );
}
