import { useEffect } from "react";

// Repeated presses use the current button state, so completion and rewind share
// exactly the same path as pointer navigation. All listeners/timers are cleaned up.
export function useArrowNavigation(
  overview: boolean,
  closeOverview: () => void,
) {
  useEffect(() => {
    let held: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      held = null;
    };
    const repeat = (delay: number) => {
      const button = document.getElementById(
        held === "ArrowRight" ? "next" : "previous",
      ) as HTMLButtonElement;
      if (button.disabled) {
        stop();
        return;
      }
      button.click();
      timer = setTimeout(() => {
        if (held) repeat(150);
      }, delay);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        stop();
        return;
      }
      if (event.defaultPrevented) return;
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
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.repeat || held === event.key) return;
        stop();
        held = event.key;
        repeat(350);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === held) stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
    };
  }, [overview, closeOverview]);
}
