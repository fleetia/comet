import { useRef, useState } from "react";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
export function useConnectionCommand(): {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: (
    name: string,
    args: Record<string, unknown>,
    onError?: (message: string) => void,
  ) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  function clearError(): void {
    setError(null);
  }
  async function run(
    name: string,
    args: Record<string, unknown>,
    onError?: (message: string) => void,
  ): Promise<boolean> {
    if (!isDesktop()) {
      const message = "연결과 조회는 데스크톱 앱에서 사용할 수 있어요.";
      setError(message);
      onError?.(message);
      return false;
    }
    if (pending.current) {
      return false;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await command(name, args);
      return true;
    } catch (cause: unknown) {
      const message = errorText(cause);
      setError(message);
      onError?.(message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, clearError, run };
}
