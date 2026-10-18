import type { CharacterPack } from "../../types";

/** Personal records a shared file may carry; each is brought along only when chosen. */
export type ArchiveChoice = { memories: boolean; affinity: boolean; messages: boolean };
export const NO_ARCHIVE: ArchiveChoice = { memories: false, affinity: false, messages: false };

/** Drops unchosen records and the people only they referenced, as the importer requires. */
export function withArchiveChoice(pack: CharacterPack, choice: ArchiveChoice): CharacterPack {
  const archive = pack.archive;
  if (!archive) return pack;
  const memories = choice.memories ? archive.memories : [];
  const affinity = choice.affinity ? archive.affinity : [];
  const messages = choice.messages ? archive.messages : [];
  const used = new Set([...memories, ...affinity, ...messages].map((entry) => entry.personId));
  if (!used.size) return { ...pack, archive: null };
  return {
    ...pack,
    archive: {
      ...archive,
      people: archive.people.filter((person) => used.has(person.id)),
      memories,
      affinity,
      messages,
    },
  };
}
