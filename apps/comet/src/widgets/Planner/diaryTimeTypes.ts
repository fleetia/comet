export type DiaryTimeColor = "work" | "record" | "life" | "exercise" | "rest" | "focus";
export type DiaryTimeCategory = { id: string; name: string; color: DiaryTimeColor };
export type DiaryTimeRecord = {
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
  categoryId: string;
  title: string;
};
