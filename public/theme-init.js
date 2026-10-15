// ParaNaga theme init (Increment A, Task 2). Loaded with a plain <script src> at the top of <head>
// (src/app/layout.tsx), so it runs synchronously before the first paint: it reads the device
// preferences (localStorage "paranaga.prefs", see src/domain/prefs/prefs.ts) and sets
//   data-theme    = "light" | "dark" | "system"   (System follows prefers-color-scheme in CSS)
//   data-contrast = "more" when High contrast is on (attribute absent otherwise)
// on <html>. A same-origin file rather than an inline script, so it passes a script-src 'self' CSP.
// Bad or missing data falls back to the defaults (System, normal contrast). No globals.
(function () {
  var root = document.documentElement;
  var theme = "system";
  var contrast = false;
  try {
    var prefs = JSON.parse(window.localStorage.getItem("paranaga.prefs") || "null");
    if (prefs && typeof prefs === "object") {
      if (prefs.theme === "light" || prefs.theme === "dark") theme = prefs.theme;
      contrast = prefs.highContrast === true;
    }
  } catch {
    // Storage blocked or malformed JSON: keep the defaults.
  }
  root.setAttribute("data-theme", theme);
  if (contrast) root.setAttribute("data-contrast", "more");
  else root.removeAttribute("data-contrast");
})();
