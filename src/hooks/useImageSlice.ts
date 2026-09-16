import { useEffect, useState, type CSSProperties } from "react";
import { centerSlice, type Slice } from "../components/characterIdentity";

export function useImageSlice(url: string | null): Slice | null {
  const [slice, setSlice] = useState<{ url: string; slice: Slice } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setSlice({ url, slice: centerSlice(image.naturalWidth, image.naturalHeight) });
      }
    };
    image.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  return url && slice?.url === url ? slice.slice : null;
}

export function skinStyle(url: string, slice: Slice): CSSProperties {
  const widths = `${slice.top}px ${slice.right}px ${slice.bottom}px ${slice.left}px`;
  return {
    borderStyle: "solid",
    borderWidth: widths,
    borderImageSource: `url("${url}")`,
    borderImageSlice: `${slice.top} ${slice.right} ${slice.bottom} ${slice.left} fill`,
    borderImageRepeat: "stretch",
    borderRadius: 0,
    background: "transparent",
  };
}
