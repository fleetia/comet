import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { localDay } from "../toolData";

export function useDiaryToday(
  following: boolean,
  day: string,
  setDay: Dispatch<SetStateAction<string>>,
): string {
  const [today, setToday] = useState(localDay);
  useEffect(() => {
    let timer: number;
    const refresh = (): void => {
      const now = new Date();
      setToday(localDay(now));
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, next.getTime() - now.getTime() + 50);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (following) setDay((current) => current === day ? today : current);
  }, [following, day, today, setDay]);
  return today;
}
