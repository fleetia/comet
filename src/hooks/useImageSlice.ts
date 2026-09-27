import { useEffect, useState, type CSSProperties } from "react";
import { centerSlice, type Slice } from "../components/characterIdentity";

export function useImageSlice(url: string | null): { slice: Slice | null; ready: boolean } {
  const [loaded, setLoaded] = useState<{ url: string; slice: Slice | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setLoaded({ url, slice: centerSlice(image.naturalWidth, image.naturalHeight) });
      } else if (active) {
        setLoaded({ url, slice: null });
      }
    };
    image.onerror = () => {
      if (active) setLoaded({ url, slice: null });
    };
    image.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  return {
    slice: url && loaded?.url === url ? loaded.slice : null,
    ready: !url || loaded?.url === url,
  };
}

export function skinStyle(url: string, slice: Slice): CSSProperties {
  // Source pixels select the artwork; layout borders must leave room for the content.
  const scale = Math.min(1, 32 / Math.max(1, slice.top, slice.right, slice.bottom, slice.left));
  const widths = `${slice.top * scale}px ${slice.right * scale}px ${slice.bottom * scale}px ${slice.left * scale}px`;
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
