import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import * as styles from "./primitives.css";

// App-only layout and text primitives that the Comet design system does not provide.

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export type Space = keyof typeof styles.space;
export type Tone = keyof typeof styles.tone;

export type InlineProps = ComponentPropsWithoutRef<"div"> & {
  align?: keyof typeof styles.align;
  gap?: Space;
  justify?: keyof typeof styles.justify;
  wrap?: boolean;
};

export const Inline = forwardRef<HTMLDivElement, InlineProps>(
  (
    { align = "center", gap = "sm", justify = "start", wrap = true, className, ...props },
    ref,
  ): ReactElement => (
    <div
      ref={ref}
      className={cx(
        styles.inline,
        styles.space[gap],
        styles.align[align],
        styles.justify[justify],
        styles.wrap[wrap ? "true" : "false"],
        className,
      )}
      {...props}
    />
  ),
);
Inline.displayName = "Inline";

export type TextProps = HTMLAttributes<HTMLElement> & {
  as?: "span" | "p" | "div" | "small";
  tone?: Tone;
  variant?: keyof typeof styles.textVariant;
};

export function Text({
  as = "span",
  tone = "default",
  variant = "body",
  className,
  ...props
}: TextProps): ReactElement {
  return createElement(as, {
    className: cx(styles.text, styles.textVariant[variant], styles.tone[tone], className),
    ...props,
  });
}

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  tone?: Tone;
  variant?: keyof typeof styles.headingVariant;
};

export function Heading({
  level = 2,
  tone = "accent",
  variant = "section",
  className,
  ...props
}: HeadingProps): ReactElement {
  return createElement(`h${level}`, {
    className: cx(styles.heading, styles.headingVariant[variant], styles.tone[tone], className),
    ...props,
  });
}

export type RuleProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  variant?: keyof typeof styles.ruleVariant;
};

export const Rule = forwardRef<HTMLDivElement, RuleProps>(
  ({ variant = "boundary", className, ...props }, ref): ReactElement => (
    <div
      ref={ref}
      role="separator"
      aria-orientation="horizontal"
      className={cx(styles.rule, styles.ruleVariant[variant], className)}
      {...props}
    />
  ),
);
Rule.displayName = "Rule";

export type SectionHeaderProps = Omit<ComponentPropsWithoutRef<"header">, "children" | "title"> & {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  headingId?: string;
  headingLevel?: HeadingProps["level"];
  headingVariant?: HeadingProps["variant"];
  rule?: RuleProps["variant"] | "none";
};

export function SectionHeader({
  title,
  description,
  aside,
  headingId,
  headingLevel = 2,
  headingVariant = "section",
  rule = "boundary",
  className,
  ...props
}: SectionHeaderProps): ReactElement {
  return (
    <header {...props} className={cx(styles.sectionHeader, className)}>
      <div className={styles.sectionHeaderMain}>
        <div className={styles.sectionHeaderCopy}>
          <Heading id={headingId} level={headingLevel} variant={headingVariant}>
            {title}
          </Heading>
          {description != null && (
            <Text as="p" tone="muted" variant="caption" className={styles.sectionHeaderDescription}>
              {description}
            </Text>
          )}
        </div>
        {aside != null && <div className={styles.sectionHeaderAside}>{aside}</div>}
      </div>
      {rule !== "none" && <Rule variant={rule} />}
    </header>
  );
}

export type SaveStatusState = keyof typeof styles.saveStatusTone;
export type SaveStatusProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "aria-live" | "children" | "role"
> & { action?: ReactNode; message?: ReactNode; state?: SaveStatusState };

const SAVE_MESSAGES: Record<SaveStatusState, string> = {
  idle: "변경 사항 없음",
  saving: "저장 중",
  saved: "저장됨",
  error: "저장하지 못했습니다.",
};
const SAVE_MARKERS: Record<SaveStatusState, string> = {
  idle: "○",
  saving: "◌",
  saved: "●",
  error: "×",
};

export function SaveStatus({
  action,
  message,
  state = "idle",
  className,
  ...props
}: SaveStatusProps): ReactElement {
  const isError = state === "error";
  return (
    <div className={cx(styles.saveStatus, styles.saveStatusTone[state], className)} {...props}>
      <div
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
        aria-atomic="true"
        className={styles.saveStatusAnnouncement}
      >
        <span aria-hidden="true" className={styles.saveStatusMarker}>
          {SAVE_MARKERS[state]}
        </span>
        <span className={styles.saveStatusMessage}>{message ?? SAVE_MESSAGES[state]}</span>
      </div>
      {action != null && <div className={styles.saveStatusAction}>{action}</div>}
    </div>
  );
}

export type ActionBarProps = ComponentPropsWithoutRef<"div"> & { status?: ReactNode };

export const ActionBar = forwardRef<HTMLDivElement, ActionBarProps>(
  ({ status, children, className, ...props }, ref): ReactElement => (
    <div ref={ref} className={cx(styles.actionBar, className)} {...props}>
      <div className={styles.actionBarStatus}>{status}</div>
      <div className={styles.actionBarActions}>{children}</div>
    </div>
  ),
);
ActionBar.displayName = "ActionBar";

export type SelectableListRowProps = ComponentPropsWithoutRef<"button"> & { selected?: boolean };

export const SelectableListRow = forwardRef<HTMLButtonElement, SelectableListRowProps>(
  ({ selected = false, className, type = "button", ...props }, ref): ReactElement => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      data-selected={selected}
      className={cx(styles.selectableListRow, className)}
      {...props}
    />
  ),
);
SelectableListRow.displayName = "SelectableListRow";

export type FieldContextValue = {
  controlId: string;
  describedBy?: string;
  isInvalid: boolean;
  isRequired: boolean;
};

export const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export function tabPanelIds(tabs: string, value: string): { tabId: string; panelId: string } {
  return { tabId: `${tabs}-${value}-tab`, panelId: `${tabs}-${value}-panel` };
}

/** Maps tab values to stable IDs for the design-system Tabs `externalPanels` prop. */
export function externalTabPanels(
  tabs: string,
  values: readonly string[],
): Record<string, { tabId: string; panelId: string }> {
  return Object.fromEntries(values.map((value) => [value, tabPanelIds(tabs, value)]));
}

export type TabPanelProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "id" | "role" | "hidden" | "aria-labelledby"
> & { tabs: string; value: string; selected: string };

/** Panel rendered outside the design-system Tabs; pair with `externalTabPanels`. */
export function TabPanel({
  tabs,
  value,
  selected,
  className,
  ...props
}: TabPanelProps): ReactElement {
  const { tabId, panelId } = tabPanelIds(tabs, value);
  return (
    <div
      tabIndex={0}
      {...props}
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={value !== selected}
      className={cx(styles.tabPanel, className)}
    />
  );
}
