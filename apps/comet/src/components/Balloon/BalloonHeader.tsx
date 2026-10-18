import type { JSX } from "react";
import { Button, IconButton } from "@comet/ui";
import * as s from "../companion.css";

export function BalloonHeader({
  label,
  showMenu,
  closeLabel,
  navigating,
  onMenu,
  onClose,
}: {
  label: string;
  showMenu: boolean;
  closeLabel: string;
  navigating: boolean;
  onMenu: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <header className={s.balloonHeader}>
      {showMenu && (
        <Button variant="ghost" size="small" disabled={navigating} onClick={onMenu}>
          메뉴로
        </Button>
      )}
      <span>{label}</span>
      <IconButton
        size="compact"
        icon="close"
        aria-label={closeLabel}
        disabled={navigating}
        onClick={onClose}
      />
    </header>
  );
}
