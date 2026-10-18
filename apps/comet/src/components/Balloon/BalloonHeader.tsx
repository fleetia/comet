import type { JSX } from "react";
import { Button, IconButton } from "../../ui";
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
        <Button variant="quiet" size="compact" disabled={navigating} onClick={onMenu}>
          메뉴로
        </Button>
      )}
      <span>{label}</span>
      <IconButton
        size="compact"
        variant="quiet"
        label={closeLabel}
        disabled={navigating}
        onClick={onClose}
      >
        ×
      </IconButton>
    </header>
  );
}
