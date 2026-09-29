import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const STORAGE_KEY = "lb-theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);

  useEffect(() => {
    apply(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
    if (pref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  const cycle = () => setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  return { pref, cycle };
}
