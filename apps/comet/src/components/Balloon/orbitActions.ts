import type { ConversationSession, InstalledCharacter, Persona } from "../../types";

type Context = {
  persona: Persona;
  character: InstalledCharacter | undefined;
  sleeping: boolean;
  paused: ConversationSession | undefined;
  perform: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
};

/** Routes a character menu action to its command. Resuming opens the paused chat, else past chats. */
export function runOrbitAction(
  action: string,
  { persona, character, sleeping, paused, perform }: Context,
): boolean | Promise<boolean> {
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
