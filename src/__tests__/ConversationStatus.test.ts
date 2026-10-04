import { expect, it } from "vitest";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";
import { aiAvailability, responseOrigin } from "../components/Balloon/conversationStatus";

it("reports selected local readiness without consulting another installed model", () => {
  expect(aiAvailability(PREVIEW_SNAPSHOT)).toEqual({
    ready: false,
    label: "AI 자유 대화 · 모델 준비 필요",
  });
  expect(aiAvailability({ ...PREVIEW_SNAPSHOT, modelReady: true })).toEqual({
    ready: true,
    label: "AI 자유 대화 · 로컬 모델 준비됨",
  });
});

it.each([
  ["https://api.example.com/v1", "model", false, false],
  ["https://api.example.com/v1", "model", true, true],
  ["https://api.example.com/v1", "   ", true, false],
  ["http://localhost:8080/v1", "model", false, true],
  ["http://127.0.0.1:8080/v1", "model", false, true],
  ["http://[::1]:8080/v1", "model", false, true],
  ["http://api.example.com/v1", "model", true, false],
  ["https://user:password@example.com/v1", "model", true, false],
  ["http://localhost:8080/v1?token=value", "model", false, false],
  ["http://localhost:8080/v1#anchor", "model", false, false],
  ["not a url", "model", true, false],
])("describes API configuration readiness for %s", (baseUrl, apiModel, hasApiKey, ready) => {
  const status = aiAvailability({
    ...PREVIEW_SNAPSHOT,
    modelReady: true,
    hasApiKey,
    settings: { ...PREVIEW_SNAPSHOT.settings, mode: "api", baseUrl, apiModel },
  });
  expect(status.ready).toBe(ready);
  expect(status.label).toBe(ready ? "AI 자유 대화 · API 설정됨" : "AI 자유 대화 · API 설정 필요");
});

it.each([
  ["wordbook", "등록 대사 · 단어장"],
  ["script", "등록 대사"],
  ["talk", "등록 대사 · 대화팩"],
  ["reaction", "등록 대사 · 반응"],
  ["story", "등록 대사 · 이야기"],
  ["widget", "위젯 대사"],
  ["llm", "AI 생성"],
  ["question", "AI 생성 · 질문"],
  ["unknown", "출처 미확인"],
  ["future-source", "출처 미확인"],
  [undefined, "출처 미확인"],
])("uses recorded source %s without guessing an origin", (source, label) => {
  expect(responseOrigin(source)).toBe(label);
});
