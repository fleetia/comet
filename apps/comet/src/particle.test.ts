import { describe, expect, it } from "vitest";
import { particle } from "./particle";

describe("particle", () => {
  it.each([
    ["별꼬리", "를", "는", "와"],
    ["구름양", "을", "은", "과"],
    ["Ruby", "를", "는", "와"],
    ["Sam", "을", "은", "과"],
  ])("%s의 마지막 소리에 맞춘다", (word, object, topic, withWord) => {
    expect(particle(word, "object")).toBe(object);
    expect(particle(word, "topic")).toBe(topic);
    expect(particle(word, "with")).toBe(withWord);
  });
});
