/** Toys that are taken out onto the real desktop instead of opening a tool window. */
export const DESKTOP_TOYS: readonly string[] = ["ball", "paper-plane", "bubbles", "pet"];

export function isDesktopToy(kind: string): boolean {
  return DESKTOP_TOYS.includes(kind);
}
