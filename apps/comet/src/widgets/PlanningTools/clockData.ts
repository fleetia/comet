import { localDay, record, rows, text, type DataRecord } from "../toolData";

export function clockFeatured(data: DataRecord): DataRecord | undefined {
  if (data.featuredEnabled === false) return undefined;
  const items = rows(data.anniversaries);
  return items.find((item) => item.id === data.featuredId) ?? items[0];
}
export function clockTime(data: DataRecord, now = Date.now()): string {
  return new Date(now).toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    ...(data.showSeconds === true ? { second: "2-digit" } : {}),
    hour12: data.format === "12h",
  });
}
export function clockDate(data: DataRecord, now = Date.now()): string {
  return data.showDate === false
    ? ""
    : new Date(now).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
}
export function anniversaryTarget(item: DataRecord, now = Date.now()): Date {
  const saved = new Date(`${text(item.date)}T12:00:00`);
  if (
    !Number.isFinite(saved.getTime()) ||
    (item.repeat !== "yearly" && item.countMode !== "anniversary")
  )
    return saved;
  const today = new Date(`${localDay(new Date(now))}T12:00:00`);
  let year = Math.max(saved.getFullYear(), today.getFullYear());
  function atYear(value: number): Date {
    const last = new Date(value, saved.getMonth() + 1, 0).getDate();
    return new Date(value, saved.getMonth(), Math.min(saved.getDate(), last), 12);
  }
  if (atYear(year).getTime() < today.getTime()) year += 1;
  return atYear(year);
}
export function anniversaryLabel(item: DataRecord, now = Date.now()): string {
  const target =
    item.countMode === "elapsed"
      ? new Date(`${text(item.date)}T12:00:00`)
      : anniversaryTarget(item, now);
  if (!Number.isFinite(target.getTime())) return "날짜 확인 필요";
  const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const current = new Date(now);
  const today = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
  const days = Math.round((targetDay - today) / 86400000);
  if (item.countMode === "anniversary") {
    const original = new Date(`${text(item.date)}T12:00:00`);
    return days === 0
      ? `${target.getFullYear() - original.getFullYear()}주년`
      : `${target.getFullYear() - original.getFullYear()}주년까지 ${days}일`;
  }
  return days === 0 ? "D-day" : days > 0 ? `D-${days}` : `D+${-days}`;
}
export function anniversaryDescription(item: DataRecord): string {
  const date = new Date(`${text(item.date)}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return text(item.date);
  const label =
    item.repeat === "yearly"
      ? `매년 ${date.getMonth() + 1}월 ${date.getDate()}일`
      : date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const mode = record({ remaining: "남은 날", elapsed: "지난 날", anniversary: "주년" });
  return `${label} · ${text(mode[text(item.countMode)]) || "남은 날"} 세기`;
}
