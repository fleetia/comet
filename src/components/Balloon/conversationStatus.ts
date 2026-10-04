import type { Snapshot } from "../../types";

/** Configuration readiness, not a promise that an inference request will succeed. */
export function aiAvailability(snapshot: Snapshot): { ready: boolean; label: string } {
  if (snapshot.settings.mode === "local") {
    return snapshot.modelReady
      ? { ready: true, label: "AI 자유 대화 · 로컬 모델 준비됨" }
      : { ready: false, label: "AI 자유 대화 · 모델 준비 필요" };
  }
  let validUrl = false;
  let loopback = false;
  try {
    const url = new URL(snapshot.settings.baseUrl.trim());
    loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    validUrl =
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.href.includes("?") &&
      !url.href.includes("#");
  } catch {
    // A missing or invalid address is setup, not a verified connection.
  }
  const ready =
    validUrl && Boolean(snapshot.settings.apiModel.trim()) && (loopback || snapshot.hasApiKey);
  return {
    ready,
    label: ready ? "AI 자유 대화 · API 설정됨" : "AI 자유 대화 · API 설정 필요",
  };
}

/** Only recorded provenance decides this label; never infer it from current model settings. */
export function responseOrigin(source?: string): string {
  switch (source) {
    case "llm":
      return "AI 생성";
    case "question":
      return "AI 생성 · 질문";
    case "wordbook":
      return "등록 대사 · 단어장";
    case "script":
      return "등록 대사";
    case "talk":
      return "등록 대사 · 대화팩";
    case "reaction":
      return "등록 대사 · 반응";
    case "story":
      return "등록 대사 · 이야기";
    case "widget":
      return "위젯 대사";
    case "archive":
    case "imported":
      return "가져온 기록";
    default:
      return "출처 미확인";
  }
}
