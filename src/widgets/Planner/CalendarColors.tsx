import { useId, useState, type ReactElement } from "react";
import type { DataRecord } from "../toolData";
import { CALENDAR_PALETTE, calendarSources, sourceColor } from "./calendarColorData";
import * as s from "./calendarColors.css";

export function CalendarColors({
  connections,
  events,
  colors,
  disabled = false,
  onChange,
  connectionId,
}: {
  connections: DataRecord[];
  events: DataRecord[];
  colors: DataRecord;
  disabled?: boolean;
  onChange: (input: { connectionId: string; calendarId: string; color: string }) => void;
  connectionId?: string;
}): ReactElement | null {
  const [opened, setOpened] = useState<string | null>(null);
  const paletteId = useId();
  const sources = calendarSources(connections, events).filter(
    (source) => connectionId === undefined || source.connectionId === connectionId,
  );
  if (sources.length === 0) {
    return null;
  }
  return (
    <div className={s.list} role="group" aria-label="캘린더 색상">
      {sources.map((source, index) => {
        const key = JSON.stringify([source.connectionId, source.calendarId]);
        const color = sourceColor(source, colors);
        const label =
          source.connectionName === source.name
            ? source.name
            : `${source.connectionName} · ${source.name}`;
        const expanded = opened === key;
        return (
          <div key={key}>
            <div className={s.row}>
              <button
                className={s.trigger}
                type="button"
                disabled={disabled}
                aria-label={`${label} 색상 변경`}
                aria-expanded={expanded}
                aria-controls={expanded ? `${paletteId}-${index}` : undefined}
                onClick={() => setOpened(expanded ? null : key)}
              >
                <span className={s.swatch} style={{ backgroundColor: color }} />
              </button>
              <div className={s.name}>
                <span>{source.name}</span>
                {connectionId === undefined && source.connectionName !== source.name && (
                  <span className={s.connection}>{source.connectionName}</span>
                )}
              </div>
            </div>
            {expanded && (
              <div
                id={`${paletteId}-${index}`}
                className={s.palette}
                role="group"
                aria-label={`${label} 색상 선택`}
              >
                {CALENDAR_PALETTE.map((choice) => (
                  <button
                    key={choice.color}
                    className={s.choice}
                    type="button"
                    disabled={disabled}
                    aria-label={choice.name}
                    title={choice.name}
                    aria-pressed={choice.color === color}
                    onClick={() =>
                      onChange({
                        connectionId: source.connectionId,
                        calendarId: source.calendarId,
                        color: choice.color,
                      })
                    }
                  >
                    <span className={s.swatch} style={{ backgroundColor: choice.color }}>
                      {choice.color === color && <span aria-hidden="true">✓</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
