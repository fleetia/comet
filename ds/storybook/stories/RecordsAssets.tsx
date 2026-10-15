import type { ReactElement, ReactNode } from "react";
import { tokens } from "@comet/token";

export function RecordSampleIcon({ name }: { name: string }): ReactElement {
  return <img src={`/records/${name}.svg`} alt="" style={{ flexShrink: 0, display: "block" }} />;
}

export function RecordSampleTile({
  children,
  size = 40,
}: {
  children: ReactNode;
  size?: number;
}): ReactElement {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        display: "inline-flex",
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
        background: tokens["color/icon-tile"],
      }}
    >
      {children}
    </span>
  );
}

export function RecordSampleCharacter({ launcher = false }: { launcher?: boolean }): ReactElement {
  const size = launcher ? 36 : 34;
  const drawing = launcher ? 31 : 29;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: launcher ? 12 : 11,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: tokens["color/component/cat-rest-alpha-160"],
      }}
    >
      <span style={{ position: "relative", width: drawing, height: drawing }}>
        <span style={{ position: "absolute", left: "20.31%", top: "15.63%" }}>
          <RecordSampleIcon name={launcher ? "launcher-character" : "conversation-character"} />
        </span>
      </span>
    </span>
  );
}

export function RecordSampleLocation({ selected = false }: { selected?: boolean }): ReactElement {
  const suffix = selected ? "-selected" : "";
  return (
    <span
      aria-hidden
      style={{ position: "relative", width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
    >
      <span style={{ position: "absolute", left: 3.32, top: 2.04 }}>
        <RecordSampleIcon name={`location-outline${suffix}`} />
      </span>
      <span style={{ position: "absolute", left: 5.88, top: 4.6 }}>
        <RecordSampleIcon name={`location-center${suffix}`} />
      </span>
    </span>
  );
}

export function RecordsStack({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignItems: "flex-start",
        maxWidth: "100%",
      }}
    >
      {children}
    </div>
  );
}

export function RecordSampleGesture(): ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ position: "relative", width: 18, height: 18, flexShrink: 0 }}>
        <span style={{ position: "absolute", left: 3.094, top: 2.813 }}>
          <RecordSampleIcon name="gesture-body" />
        </span>
        <span style={{ position: "absolute", left: 2.25, top: 4.5 }}>
          <RecordSampleIcon name="gesture-tail" />
        </span>
      </span>
      장난
    </span>
  );
}
