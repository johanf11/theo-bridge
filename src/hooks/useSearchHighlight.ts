import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { SEARCH_ID_PARAM } from "@/lib/search";

/** Returns highlight id from URL and scrolls matching ref into view when data loads. */
export function useSearchHighlight<T extends HTMLElement>(ready = true) {
  const location = useLocation();
  const highlightId = new URLSearchParams(location.search).get(SEARCH_ID_PARAM);
  const refs = useRef<Record<string, T | null>>({});

  useEffect(() => {
    if (!highlightId || !ready) return;

    const scroll = () => {
      const el = refs.current[highlightId];
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    };

    scroll();
    const timer = setTimeout(scroll, 150);
    return () => clearTimeout(timer);
  }, [highlightId, ready]);

  return { highlightId, refs };
}
