import { Component, Suspense, type JSX, type ReactNode } from "react";
import { WindowHeader } from "./WindowHeader/WindowHeader";
import * as s from "../common.css";

type Props = { children: ReactNode; title?: string; desktop?: boolean };

function Placeholder({
  title,
  desktop,
  failed = false,
}: Omit<Props, "children"> & { failed?: boolean }): JSX.Element {
  return (
    <main className={s.loading}>
      {desktop && (
        <div className={s.loadingHeader}>
          <WindowHeader label="창 닫기" title={title}>
            <span className={s.eyebrow}>comet</span>
          </WindowHeader>
        </div>
      )}
      <p role={failed ? "alert" : "status"}>
        {failed
          ? desktop
            ? "화면을 불러오지 못했어요. 앱을 다시 시작해 주세요."
            : "미리보기를 불러오지 못했어요. 페이지를 새로고침해 주세요."
          : "…"}
      </p>
    </main>
  );
}

/** Keep the native close control available while an optional surface loads. */
export class LazySurface extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    const { children, ...placeholder } = this.props;
    if (this.state.failed) return <Placeholder {...placeholder} failed />;
    return <Suspense fallback={<Placeholder {...placeholder} />}>{children}</Suspense>;
  }
}
