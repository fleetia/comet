import { useEffect, useState, type JSX } from "react";
import { Button } from "@fleetia/lagrange";
import type { Message, Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../companion.css";
import * as ui from "../../lagrange.css";

type HistoryPage = {
  items: Message[];
  userNames: Record<string, string>;
  characterNames: Record<string, string>;
  total: number;
  offset: number;
  nextOffset: number | null;
};

export function CharacterHistory({
  snapshot,
  characterId,
}: {
  snapshot: Snapshot;
  characterId: string;
}): JSX.Element {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    setPending(true);
    void command<HistoryPage>("list_character_history", { characterId, offset, limit: 50 })
      .then((result) => {
        if (active) {
          setPage(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [characterId, offset, snapshot.messages, refresh]);
  const messages = isDesktop() ? (page?.items ?? []) : snapshot.messages;
  const userNames = page?.userNames ?? snapshot.messageUserNames;
  const character = snapshot.characters.installed.find((item) => item.id === characterId);
  return (
    <>
      <div className={s.history}>
        {messages.length === 0 && !pending && !error ? (
          <p className={ui.quiet}>아직 나눈 이야기가 없어요.</p>
        ) : (
          [...messages]
            .sort((left, right) => left.createdAt - right.createdAt)
            .map((message) => (
              <p className={s.historyMessage} key={message.id}>
                <span className={s.historyName}>
                  {message.role === "user"
                    ? (userNames[message.id] ?? "나")
                    : (page?.characterNames[message.id] ??
                      snapshot.messageIdentities.find(
                        (identity) => identity.messageId === message.id,
                      )?.name ??
                      character?.definition.name ??
                      "친구")}
                </span>
                {message.content}
              </p>
            ))
        )}
      </div>
      {pending && (
        <p className={ui.quiet} role="status">
          대화 기록을 불러오고 있어요.
        </p>
      )}
      {error && (
        <div className={ui.error} role="alert">
          {error}
          <Button variant="quiet" onClick={() => setRefresh((value) => value + 1)}>
            기록 다시 불러오기
          </Button>
        </div>
      )}
      {page && (
        <div className={s.row} aria-label="대화 기록 페이지">
          <Button
            size="compact"
            variant="quiet"
            disabled={pending || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            앞쪽 기록
          </Button>
          <span className={ui.quiet}>전체 {page.total}개</span>
          <Button
            size="compact"
            variant="quiet"
            disabled={pending || page.nextOffset === null}
            onClick={() => {
              if (page.nextOffset !== null) setOffset(page.nextOffset);
            }}
          >
            다음 기록
          </Button>
        </div>
      )}
    </>
  );
}
