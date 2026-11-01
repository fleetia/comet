import { useState, type ReactElement } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";

export function ImageProcessing(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  return (
    <main>
      <p role="status">이미지를 준비하고 있어요…</p>
      <Button onClick={() => void getCurrentWindow().close().catch((cause: unknown) => setError(errorText(cause)))}>
        취소
      </Button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
