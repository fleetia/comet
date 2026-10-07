import { Heading, Text } from "@fleetia/lagrange";
import type { ReactElement, ReactNode } from "react";
import { isDesktop } from "../../hooks/useSnapshot";
import type { WidgetRuntime, WidgetView } from "../types";
import * as styles from "./widgetGuide.css";

const GUIDES: Record<string, { title: string; hint: string; note?: string }> = {
  todo: {
    title: "할 일을 적고, 마친 일을 표시해요",
    hint: "할 일 창에서 목록을 나누고 날짜와 반복 주기를 정하세요. 집중할 일은 타이머와 연결할 수 있어요.",
  },
  preparation: {
    title: "준비할 것을 한곳에 모아요",
    hint: "날짜 없이 봉투를 만들고 준비 체크와 자료 링크를 담으세요. 할 일이나 캘린더 일정은 나중에 연결해도 돼요.",
  },
  "focus-timer": {
    title: "이번에 집중할 일을 골라요",
    hint: "타이머 창에서 시간을 정하고 시작하세요. 끝나면 계속 집중하거나 쉬고, 연결한 할 일은 직접 완료할 수 있어요.",
    note: "집중 중에는 캐릭터와의 대화와 자동 장난이 쉬어갑니다. 타이머가 끝나도 할 일은 자동 완료되지 않아요.",
  },
  memo: {
    title: "필요한 메모만 바탕화면에 꺼내요",
    hint: "새 메모에 바로 적고, 다 쓴 낱장은 넣어두세요. 넣어도 내용은 남아 있어요.",
    note: "목록과 검색은 다이어리의 계속 쓸 메모에서 볼 수 있어요. 낱장의 글자 크기는 메모 창에서 바꿔요.",
  },
  interaction: {
    title: "함께할 캐릭터를 골라요",
    hint: "교감 창에서 캐릭터를 골라 쓰다듬거나 콕 찌르고, 간식을 나눠보세요.",
    note: "간식이 떨어지면 교감 창에서 다시 채울 수 있어요.",
  },
  ball: {
    title: "공을 잡아 끌었다 놓아보세요",
    hint: "바탕화면에 꺼낸 공을 던지면 화면 가장자리와 다른 창의 보이는 외곽에 부딪혀 튀어요.",
    note: "꺼낸 공은 우클릭으로도 정리할 수 있어요.",
  },
  "paper-plane": {
    title: "종이비행기를 날려보세요",
    hint: "바탕화면에 꺼낸 비행기를 잡아 끌었다 놓으면 날아가요. 화면 가장자리와 다른 창의 보이는 외곽에 부딪혀요.",
    note: "꺼낸 비행기는 우클릭으로도 정리할 수 있어요.",
  },
  bubbles: {
    title: "비눗방울을 톡톡 터뜨려요",
    hint: "바탕화면에 비눗방울을 꺼내고, 떠다니는 방울을 눌러 터뜨려보세요.",
    note: "남은 비눗방울은 우클릭으로도 정리할 수 있어요.",
  },
  "small-match": {
    title: "잠깐 한 판 해요",
    hint: "놀이 창에서 주사위를 굴리거나 동전의 앞뒤를 골라보세요. 가위바위보도 할 수 있어요.",
  },
  fortune: {
    title: "가볍게 운세를 뽑아요",
    hint: "운세 창에서 뽑기를 눌러 결과를 보세요. 재미로 읽는 가상의 운세예요.",
  },
};

export function WidgetGuide({
  widget,
  runtime,
  hasLastConfirmation,
  runtimeError,
  related,
}: {
  widget: WidgetView;
  runtime?: WidgetRuntime;
  hasLastConfirmation: boolean;
  runtimeError?: string | null;
  related?: ReactNode;
}): ReactElement | null {
  const guide = GUIDES[widget.kind];
  if (!guide) {
    return null;
  }
  const isToy = ["ball", "paper-plane", "bubbles"].includes(widget.kind);
  let runtimeStatus: string | undefined;
  if (widget.kind === "memo" || isToy) {
    const name = isToy ? "장난감" : "메모 창";
    runtimeStatus = isDesktop() ? `${name} 상태 확인 중` : "데스크톱에서 확인";
    if (runtimeError) {
      runtimeStatus = `${name} 상태 확인 실패`;
    }
    if (hasLastConfirmation && isToy && runtime?.toys) {
      runtimeStatus = `준비 중 ${runtime.toys.starting}개 · 표시 ${runtime.toys.visible}개`;
      if (runtimeError) {
        runtimeStatus += " · 마지막 확인 상태";
      }
    }
    if (hasLastConfirmation && widget.kind === "memo" && runtime?.noteWindows) {
      runtimeStatus = `메모 ${runtime.noteWindows.open}개 열림 · ${runtime.noteWindows.visible}개 표시`;
      if (runtimeError) {
        runtimeStatus += " · 마지막 확인 상태";
      }
    }
  }
  return (
    <section className={styles.guide} data-widget-guide>
      <div className={styles.introduction}>
        <Heading level={4} variant="subsection">
          {guide.title}
        </Heading>
        <Text as="p">{guide.hint}</Text>
        {guide.note && (
          <Text as="p" variant="caption" tone="muted">
            {guide.note}
          </Text>
        )}
      </div>
      {runtimeStatus && (
        <Text as="p" variant="caption" role="status" className={styles.runtime}>
          {runtimeStatus}
        </Text>
      )}
      {related && <div className={styles.related}>{related}</div>}
    </section>
  );
}
