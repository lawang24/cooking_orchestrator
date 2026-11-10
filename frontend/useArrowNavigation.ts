import { useEffect } from "react";

export function useArrowNavigation(
  started: boolean,
  overview: boolean,
  closeOverview: () => void,
) {
  useEffect(() => {
    if (!started) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (overview) {
        if (event.key === "Escape") closeOverview();
        return;
      }
      if (
        (event.target as Element).closest(
          'input,select,textarea,[contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      // One deliberate press per transition, even if the cook holds the key.
      if (!event.repeat) {
        const id = event.key === "ArrowRight" ? "next" : "previous";
        (document.getElementById(id) as HTMLButtonElement)?.click();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [started, overview, closeOverview]);
}
