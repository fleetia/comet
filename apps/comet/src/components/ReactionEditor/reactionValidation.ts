import type { CharacterDefinition } from "../../types";
import { motionError } from "../MotionSelect/MotionSelect";

export function reactionError(definition: CharacterDefinition): string | null {
  const rules = definition.reactions ?? [];
  const clips = definition.animation?.clips ?? [];
  if (rules.length > 32 || new Set(rules.map((rule) => rule.event)).size !== rules.length)
    return "사건마다 반응 하나씩, 최대 32개까지 연결할 수 있어요.";
  for (const rule of rules) {
    if (!Number.isInteger(rule.cooldownMs) || rule.cooldownMs < 0 || rule.cooldownMs > 60_000)
      return "대사 쿨다운은 0~60초로 입력해 주세요.";
    if (rule.variants.length === 0 || rule.variants.length > 16)
      return "반응마다 후보를 1~16개 등록해 주세요.";
    for (const variant of rule.variants) {
      if (
        variant.text !== undefined &&
        (!variant.text.trim() || Array.from(variant.text).length > 500)
      )
        return "반응 대사는 공백만 입력할 수 없고 최대 500자예요. 말하지 않으려면 비워 두세요.";
      if (variant.expression !== undefined && !(variant.expression in definition.expressions))
        return "반응의 표정이 없어요. 다른 표정이나 현재 표정을 선택해 주세요.";
      if (
        !variant.text &&
        !variant.expression &&
        (!variant.motion || variant.motion.mode === "inherit")
      )
        return "후보마다 대사·표정·동작 중 하나 이상을 지정해 주세요.";
      const error = motionError(variant.motion, clips, rule.event !== "grab-start");
      if (error) return error;
    }
  }
  return null;
}
