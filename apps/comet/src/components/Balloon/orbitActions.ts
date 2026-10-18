import type { ConversationSession, InstalledCharacter, Persona } from "../../types";

type Context = {
  persona: Persona;
  character: InstalledCharacter | undefined;
  sleeping: boolean;
  resumableWork: ConversationSession | undefined;
  paused: ConversationSession | undefined;
  perform: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  chooseResumeNote: () => void;
};

/** Routes a character menu action to its command. Resuming prefers linked work, then a paused chat. */
export function runOrbitAction(
  action: string,
  { persona, character, sleeping, resumableWork, paused, perform, chooseResumeNote }: Context,
): boolean | Promise<boolean> {
  switch (action) {
    case "chat":
      return perform("open_panel", { persona, mode: "input" });
    case "resume":
      if (resumableWork) return perform("resume_chat", { sessionId: resumableWork.id });
      else if (paused) return perform("resume_chat", { sessionId: paused.id });
      else chooseResumeNote();
      return true;
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
