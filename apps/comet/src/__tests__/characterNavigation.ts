import { fireEvent, screen, within } from "@testing-library/react";

export function openCharacterLibrary(): void {
  if (screen.queryByRole("region", { name: "설치된 캐릭터" })) return;
  const path = screen.queryByRole("navigation", { name: "친구 편집 경로" });
  const back = path
    ? within(path).getByRole("button", { name: "친구들로 돌아가기" })
    : within(screen.getByRole("tabpanel", { name: "친구 정보" })).getByRole("button", {
        name: "친구들",
      });
  fireEvent.click(back);
}

export function openCharacterPage(page: string): void {
  if (screen.queryByRole("tabpanel", { name: page })) {
    if (page === "모습·표정") openExpressionEditor();
    return;
  }
  const library = screen.queryByRole("region", { name: "설치된 캐릭터" });
  if (library) {
    const first = within(library).getAllByRole("button", { name: /.+ 자세히$/ })[0];
    fireEvent.click(first);
  }
  const path = screen.queryByRole("navigation", { name: "친구 편집 경로" });
  if (path) fireEvent.click(within(path).getByRole("button", { name: "친구 정보로 돌아가기" }));
  if (page === "친구 정보") return;
  const label = page === "관리" ? "기억 관리" : page;
  fireEvent.click(
    within(screen.getByRole("tabpanel", { name: "친구 정보" })).getByRole("button", {
      name: label,
    }),
  );
  if (page === "모습·표정") openExpressionEditor();
}

function openExpressionEditor(): void {
  const summary = screen.queryByText("선택한 표정 편집");
  if (summary && !summary.closest("details")?.open) fireEvent.click(summary);
}

export function selectFriend(name: RegExp): void {
  const path = screen.queryByRole("navigation", { name: "친구 편집 경로" });
  const page = path?.lastElementChild?.textContent;
  openCharacterLibrary();
  fireEvent.click(
    within(screen.getByRole("region", { name: "설치된 캐릭터" })).getByRole("button", {
      name: (label) => name.test(label) && label.endsWith(" 자세히"),
    }),
  );
  if (page && page !== "친구 정보") openCharacterPage(page);
}

export function addNewFriend(): void {
  openFriendPacks();
  fireEvent.click(screen.getByRole("button", { name: "새로 만들기" }));
}

export function openFriendPacks(): void {
  openCharacterLibrary();
  fireEvent.click(
    within(screen.getByRole("region", { name: "설치된 캐릭터" })).getByRole("button", {
      name: "친구 추가…",
    }),
  );
}
