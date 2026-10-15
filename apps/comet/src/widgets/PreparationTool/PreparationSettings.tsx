import type { ReactElement } from "react";
import { Icon } from "@comet/icon";
import { SettingControlRow, Surface, type SettingControlRowProps } from "@comet/ui";
import type { WidgetView } from "../types";
import * as s from "./preparationSettings.css";

export function PreparationSettings({
  widgets,
  onOpenRelated,
}: {
  widgets: WidgetView[];
  onOpenRelated?: (widget: WidgetView) => void;
}): ReactElement {
  const connections = [
    {
      kind: "todo",
      title: "할 일",
      description: "할 일을 옮겨서 챙길 것을 모아요",
      icon: "todo" as const,
    },
    {
      kind: "calendar",
      title: "캘린더",
      description: "봉투에 일정을 이어 둬요",
      icon: "calendar" as const,
    },
    {
      kind: "focus-timer",
      title: "집중 타이머",
      description: "봉투를 열고 바로 집중해요",
      icon: "timer" as const,
    },
  ];
  return (
    <section className={s.root} aria-label="준비 봉투 설정">
      <h2 className={s.heading}>이렇게 써요</h2>
      <div className={s.steps}>
        {[
          "날짜 없이 봉투를 먼저 만들어요.",
          "챙길 것과 자료 링크를 담아요.",
          "할 일이나 일정은 나중에 이어요.",
        ].map((label, index) => (
          <Surface key={label} className={s.step}>
            <span className={s.number}>{index + 1}</span>
            <p>{label}</p>
          </Surface>
        ))}
      </div>
      <h2 className={s.heading}>함께 쓰기</h2>
      <Surface className={s.connections}>
        {connections.map((item) => {
          const widget = widgets.find((value) => value.kind === item.kind);
          const status =
            widget?.installed && widget.enabled
              ? "켜짐"
              : widget?.installed
                ? "꺼짐"
                : "설치 안 됨";
          const row: SettingControlRowProps = {
            title: (
              <span className={s.title}>
                <Icon name={item.icon} size={18} />
                {item.title}
              </span>
            ),
            description: item.description,
            control: <span className={s.status}>{status}</span>,
          };
          return onOpenRelated && widget ? (
            <button
              key={item.kind}
              className={s.relatedButton}
              onClick={() => onOpenRelated(widget)}
            >
              <SettingControlRow {...row} />
            </button>
          ) : (
            <SettingControlRow key={item.kind} {...row} />
          );
        })}
      </Surface>
      <p className={s.caption}>같이 쓰면 좋은 도구들이에요. 준비 봉투는 혼자서도 쓸 수 있어요.</p>
    </section>
  );
}
