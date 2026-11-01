type Particle = "object" | "topic" | "with";

export function particle(word: string, kind: Particle): string {
  const last = word.trim().normalize("NFC").slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  const hasFinal = code >= 0 && code < 11172
    ? code % 28 !== 0
    : /[LMNR013678]/i.test(last);
  const choices = { object: ["을", "를"], topic: ["은", "는"], with: ["과", "와"] };
  return choices[kind][hasFinal ? 0 : 1];
}
