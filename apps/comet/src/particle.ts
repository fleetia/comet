type Particle = "object" | "topic" | "with";

export function particle(word: string, kind: Particle): string {
  const last = word.trim().normalize("NFC").slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  let hasFinal: boolean | null = null;
  if (code >= 0 && code < 11172) {
    hasFinal = code % 28 !== 0;
  } else if (/^[LMNR013678]$/i.test(last)) {
    hasFinal = true;
  } else if (/^[AEIOUY2459]$/i.test(last)) {
    hasFinal = false;
  }
  const choices = { object: ["을", "를", "을(를)"], topic: ["은", "는", "은(는)"], with: ["과", "와", "와(과)"] };
  if (hasFinal === null) {
    return choices[kind][2];
  }
  return choices[kind][hasFinal ? 0 : 1];
}
