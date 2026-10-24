import type { ConversationSession, InstalledCharacter, Persona } from "../../types";

type Context = {
  persona: Persona;
  character: InstalledCharacter | undefined;
  sleeping: boolean;
  paused: ConversationSession | undefined;
  perform: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
};

/** "같이 놀기" choices: the play widget to open and the game it starts on. */
const PLAY: Record<string, { kind: string; mode?: string }> = {
  "play-dice": { kind: "small-match", mode: "dice" },
  "play-coin": { kind: "small-match", mode: "coin" },
  "play-rps": { kind: "small-match", mode: "rps" },
  "play-number": { kind: "guessing", mode: "number" },
  "play-cups": { kind: "guessing", mode: "cups" },
  "play-fortune": { kind: "fortune" },
  "toy-ball": { kind: "ball" },
  "toy-paper-plane": { kind: "paper-plane" },
  "toy-bubbles": { kind: "bubbles" },
  "toy-pet": { kind: "pet" },
};

/** Routes a character menu action to its command. Resuming opens the paused chat, else past chats. */
export function runOrbitAction(
  action: string,
  { persona, character, sleeping, paused, perform }: Context,
): boolean | Promise<boolean> {
  if (PLAY[action]) return perform("open_play_widget", { mode: null, ...PLAY[action] });
  switch (action) {
    case "chat":
      return perform("open_panel", { persona, mode: "input" });
    case "resume":
      if (paused) return perform("resume_chat", { sessionId: paused.id });
      return perform("open_panel", { persona, mode: "history" });
    case "together":
      return perform("talk_now");
    case "history":
      return perform("open_panel", { persona, mode: "history" });
    case "settings":
      return perform("open_settings");
    case "hide":
      return perform("hide_boxes");
    case "move":
      return perform("arm_character_move", { persona });
    case "snack":
      return perform("give_character_snack", { persona });
    case "stroke":
    case "poke":
      return perform("touch_character_from_menu", { persona, action });
    case "drink":
    case "gift":
      if (character)
        return perform("give_character_item", {
          characterId: character.id,
          action,
          sessionId: crypto.randomUUID(),
        });
      return false;
    case "sleep":
      if (character)
        return perform("set_character_sleep", { characterId: character.id, sleeping: !sleeping });
      return false;
    case "pause":
      return perform("set_paused", { paused: false });
    case "pause-hour":
      return perform("set_paused", { paused: true, minutes: 60 });
    case "pause-restart":
      return perform("set_paused", { paused: true });
  }
  return false;
}
