import {
  forwardRef,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
  type SVGProps,
} from "react";

export type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "viewBox" | "ref" | "dangerouslySetInnerHTML"
> & {
  size?: number | string;
  label?: string;
};

type SourceProps = Pick<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "xmlns">;

export function createIcon(
  displayName: string,
  source: SourceProps,
  shapes: ReactNode,
): ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>> {
  const Component = forwardRef<SVGSVGElement, IconProps>(
    (
      {
        size = 20,
        width = size,
        height = size,
        label,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        "aria-hidden": ariaHidden,
        role,
        focusable = false,
        ...props
      },
      ref,
    ) => {
      const accessibleLabel = label ?? ariaLabel;
      const hasLabel = Boolean(accessibleLabel || ariaLabelledBy);

      return (
        <svg
          {...source}
          {...props}
          ref={ref}
          viewBox={source.viewBox}
          width={width}
          height={height}
          role={role ?? (hasLabel ? "img" : undefined)}
          aria-hidden={ariaHidden ?? (hasLabel ? undefined : true)}
          aria-label={accessibleLabel}
          aria-labelledby={ariaLabelledBy}
          focusable={focusable}
        >
          {shapes}
        </svg>
      );
    },
  );

  Component.displayName = displayName;
  return Component;
}
