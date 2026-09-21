import { useRef, useState } from "react";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
export function useConnectionCommand(): {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: (name: string, args: Record<string, unknown>) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  function clearError(): void {
    setError(null);
  }
  async function run(name: string, args: Record<string, unknown>): Promise<boolean> {
    if (!isDesktop()) {
      setError("연결과 조회는 데스크톱 앱에서 사용할 수 있어요.");
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
      setError(errorText(cause));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, clearError, run };
}
