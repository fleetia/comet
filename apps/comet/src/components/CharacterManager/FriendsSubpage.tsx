import type { JSX, ReactNode } from "react";
import { Button } from "@comet/ui";
import { ChevLeftIcon, Icon } from "@comet/icon";
import * as detail from "../CharacterEditor/friendDetail.css";
import * as friends from "./friends.css";

export function FriendsSubpage({
  title,
  hidden,
  backDisabled,
  onBack,
  children,
}: {
  title: string;
  hidden?: boolean;
  backDisabled?: boolean;
  onBack: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={friends.subpage} aria-label={title} hidden={hidden}>
      <nav className={detail.breadcrumbs} aria-label={`${title} 경로`}>
        <Button
          variant="ghost"
          size="small"
          aria-label="친구들로 돌아가기"
          disabled={backDisabled}
          onClick={onBack}
        >
          <ChevLeftIcon size={15} />
          친구들
        </Button>
        <Icon name="chev" size={13} />
        <span className={detail.currentCrumb}>{title}</span>
      </nav>
      {children}
    </section>
  );
}
