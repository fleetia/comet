import { lazy, type JSX, type ReactNode } from "react";
import { Button } from "@comet/ui";
import { CompanionBox } from "./components/CompanionBox/CompanionBox";
import { FaceTag } from "./components/FaceTag/FaceTag";
import { Balloon } from "./components/Balloon/Balloon";
import { ConversationResponse } from "./components/Balloon/ConversationResponse";
import { ConversationHistoryWindow } from "./components/Balloon/ConversationHistoryWindow";
import "./settingsSurfaceStyles";
import { DesktopToy } from "./components/DesktopToy/DesktopToy";
import { WidgetTool } from "./widgets/WidgetTool/WidgetTool";
import { WidgetWorkshop } from "./widgets/GeneratedWidgets/WidgetWorkshop";
import { GeneratedWidgetTool } from "./widgets/GeneratedWidgets/GeneratedWidgetTool";
import { GeneratedWidgetExecutor } from "./widgets/GeneratedWidgets/GeneratedWidgetExecutor";
import { WidgetStateRules } from "./widgets/GeneratedWidgets/WidgetStateRules";
import { Launcher } from "./components/Launcher/Launcher";
import { Diary } from "./widgets/Planner/Diary";
import { Travel } from "./widgets/Travel/Travel";
import { WidgetStack } from "./widgets/WidgetDisplay/WidgetStack";
import { WidgetDisplay } from "./widgets/WidgetDisplay/WidgetDisplay";
import { WidgetEditor } from "./widgets/WidgetDisplay/WidgetEditor";
import { MemoNote } from "./widgets/MemoNote/MemoNote";
import { WindowHeader } from "./components/WindowHeader/WindowHeader";
import { command, isDesktop, useSnapshot } from "./hooks/useSnapshot";
import { useAnalyticsConsent } from "./hooks/useAnalyticsConsent";
import * as s from "./common.css";
import { LazySurface } from "./components/LazySurface";

// Keep these identities stable across snapshot updates, preserving mounted drafts.
const SettingsPanel = lazy(() =>
  import("./components/SettingsPanel/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  })),
);
// Preview also imports SettingsPanel; keep that alternate eager path out of native views.
const DesktopPreview = lazy(() =>
  import("./components/DesktopPreview/DesktopPreview").then((module) => ({
    default: module.DesktopPreview,
  })),
);

// Independent tools own their own data subscriptions; they do not need app history.
function standaloneRoute(query: URLSearchParams): JSX.Element | null {
  const view = query.get("view");
  if (view === "generated-widget-executor")
    return <GeneratedWidgetExecutor token={query.get("token") ?? ""} />;
  if (view === "widget-workshop") return <WidgetWorkshop />;
  if (view === "generated-widget") return <GeneratedWidgetTool id={query.get("id") ?? ""} />;
  if (view === "widget-state-rules") return <WidgetStateRules id={query.get("id") ?? ""} />;
  if (view === "planner") return <Diary />;
  if (view === "travel") return <Travel />;
  if (view === "desktop-toy") return <DesktopToy id={query.get("id") ?? ""} />;
  if (view === "widget-stack") return <WidgetStack />;
  if (view === "widget-display") return <WidgetDisplay id={query.get("id") ?? ""} />;
  if (view === "widget-editor") return <WidgetEditor />;
  if (view === "memo-note") {
    return <MemoNote id={query.get("id") ?? ""} noteId={query.get("noteId") ?? ""} />;
  }
  return null;
}

function StandaloneWindow({ children }: { children: ReactNode }): JSX.Element {
  useAnalyticsConsent();
  return <>{children}</>;
}

export function App(): JSX.Element {
  const query = new URLSearchParams(window.location.search);
  const standalone = standaloneRoute(query);
  return standalone ? (
    <StandaloneWindow>{standalone}</StandaloneWindow>
  ) : (
    <SnapshotWindow query={query} />
  );
}

function SnapshotWindow({ query }: { query: URLSearchParams }): JSX.Element {
  const { snapshot, error, reload } = useSnapshot();
  const view = query.get("view");
  if (query.get("view") === "widget") {
    return (
      <WidgetTool
        id={query.get("id") ?? ""}
        characters={snapshot?.characters}
        userName={snapshot?.user?.name}
      />
    );
  }
  if (!snapshot) {
    return (
      <main className={s.loading}>
        <div className={s.loadingHeader}>
          <WindowHeader
            label="창 닫기"
            title={
              view === "launcher"
                ? "빠른 실행"
                : view === "settings"
                  ? "설정"
                  : view === "characters"
                    ? "캐릭터"
                    : view === "widgets"
                      ? "위젯"
                      : view === "conversation-history"
                        ? "지난 대화"
                        : undefined
            }
            onClose={
              view === "conversation-history"
                ? () => command("release_conversation_history")
                : view === "settings" ||
                    view === "characters" ||
                    view === "widgets" ||
                    view === "launcher"
                  ? undefined
                  : () => command(view === "balloon" ? "skip_talk" : "hide_boxes")
            }
          >
            <span className={s.eyebrow}>comet</span>
          </WindowHeader>
        </div>
        <p role="status">{error ? "준비하지 못했어요." : "…"}</p>
        {error && (
          <>
            <p className={s.error} role="alert">
              {error}
            </p>
            <Button variant="ghost" onClick={reload}>
              다시 시도
            </Button>
          </>
        )}
      </main>
    );
  }
  if (view === "launcher") return <Launcher snapshot={snapshot} />;
  if (view === "conversation-history") {
    return (
      <ConversationHistoryWindow
        snapshot={snapshot}
        initialPersona={query.get("persona") ?? undefined}
      />
    );
  }
  if (view === "conversation-input") {
    return snapshot.panel?.mode === "input" ? (
      <Balloon snapshot={snapshot} surface="input" />
    ) : (
      <></>
    );
  }
  if (view === "settings" || view === "characters" || view === "widgets") {
    return (
      <LazySurface
        desktop
        title={view === "settings" ? "설정" : view === "characters" ? "캐릭터" : "위젯"}
      >
        <SettingsPanel
          snapshot={snapshot}
          initialSection={view === "settings" ? undefined : view}
        />
      </LazySurface>
    );
  }
  if (query.get("view") === "balloon") {
    if (snapshot.panel?.mode === "input" || snapshot.panel?.mode === "history-input") {
      return <ConversationResponse snapshot={snapshot} />;
    }
    return <Balloon snapshot={snapshot} />;
  }
  const face = query.get("face");
  if (face) {
    return <FaceTag id={face} snapshot={snapshot} />;
  }
  const body = query.get("body");
  if (body) {
    return <CompanionBox id={body} snapshot={snapshot} />;
  }
  if (isDesktop()) {
    return <CompanionBox id={snapshot.characters.active[0]} snapshot={snapshot} />;
  }
  return (
    <LazySurface>
      <DesktopPreview initial={snapshot} />
    </LazySurface>
  );
}
