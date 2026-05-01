import * as React from "react";
import { useState } from "react";

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "./ui/button";

type Theme = "light" | "dark";
type ThemeSelection = Theme | "system";

const STORAGE_KEY = "_theme";

export function ThemeToggler() {
  const [theme, setTheme] = useState<ThemeSelection>(
    () =>
      (typeof window !== "undefined"
        ? (localStorage.getItem(STORAGE_KEY) as ThemeSelection)
        : "dark") || "dark"
  );

  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemEffective());

  const handleMediaQuery = React.useEffectEvent(() => {
    setSystemTheme(getSystemEffective());
  });

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    media.addEventListener("change", handleMediaQuery);
    handleMediaQuery();

    return () => media.removeEventListener("change", handleMediaQuery);
  }, []);

  const fromClip = "circle(0% at 50% 50%)";
  const toClip = "circle(150% at 50% 50%)";

  const applyTheme = React.useEffectEvent(async (themeToApply: Theme) => {
    const updateDOM = () => {
      document.documentElement.classList.toggle("dark", themeToApply === "dark");
    };

    if (!document.startViewTransition) {
      updateDOM();
      return;
    }

    const transition = document.startViewTransition(updateDOM);

    const [error] = await tryCatch(transition.ready);
    if (error) return;

    document.documentElement.animate(
      { clipPath: [fromClip, toClip] },
      {
        duration: 1000,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    );
  });

  React.useEffect(() => {
    const _theme = theme === "system" ? systemTheme : theme;

    applyTheme(_theme);
    localStorage.setItem(STORAGE_KEY, _theme);
  }, [theme, systemTheme]);

  function toggleTheme() {
    setTheme(getNextTheme(theme));
  }

  return (
    <>
      <Button onClick={toggleTheme} size="icon-sm" type="button" variant="ghost">
        {theme === "system" && <Monitor />}
        {theme === "dark" && <Moon />}
        {theme === "light" && <Sun />}

        <span className="sr-only">Toggle Theme</span>
      </Button>

      <style>
        {
          "::view-transition-old(root), ::view-transition-new(root){animation:none;mix-blend-mode:normal;}"
        }
      </style>
    </>
  );
}

function getNextTheme(theme: ThemeSelection) {
  if (theme === "dark") return "light";
  if (theme === "light") return "system";
  if (theme === "system") return "dark";
  return "light";
}

function getSystemEffective() {
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : "dark";
}
