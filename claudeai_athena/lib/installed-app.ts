/**
 * The installed app: FabOrchestrator launched from a home screen rather than
 * opened in a browser tab.
 *
 * Detected before first paint by `INSTALLED_APP_SCRIPT`, which `app/layout.tsx`
 * runs inline in <head> and which sets `data-installed-app` on <html>; script
 * reads it through `isInstalledPhone()`. It decides installed-app-only
 * presentation (a report opening scrolled to the top) — never whether
 * navigation exists: that is responsive CSS alone, the same in every context.
 *
 * Two signals, because neither alone is enough on an iPhone:
 *  · `display-mode` — the standard one; `standalone` for an installed app on
 *    Android. iOS reports an installed app with a `standalone` manifest as
 *    `fullscreen` instead (WebKit bug 264218), and only when it honours the
 *    manifest's `display` at all.
 *  · `navigator.standalone` — iOS's own flag, true for any home-screen web app
 *    however it was installed.
 * In a browser tab the display mode is `browser` and `navigator.standalone` is
 * false or absent, so neither signal is ever true there.
 */
export const INSTALLED_APP_ATTRIBUTE = "data-installed-app"

/**
 * Inline, in <head>: runs while the document is parsed, before anything is
 * painted, so the installed app never shows the browser layout first. Kept in
 * step if the display mode changes.
 */
export const INSTALLED_APP_SCRIPT = `(function(){try{var d=document.documentElement,q=["(display-mode: standalone)","(display-mode: fullscreen)","(display-mode: minimal-ui)"].map(function(m){return window.matchMedia(m)});function s(){var on=window.navigator.standalone===true||q.some(function(m){return m.matches});if(on)d.setAttribute("${INSTALLED_APP_ATTRIBUTE}","");else d.removeAttribute("${INSTALLED_APP_ATTRIBUTE}")}s();q.forEach(function(m){if(m.addEventListener)m.addEventListener("change",s);else if(m.addListener)m.addListener(s)})}catch(e){}})();`

/**
 * The installed app below Tailwind's `md` (768px). Tested as "not `md`" — the
 * exact complement — rather than `max-width: 767px`, which leaves a gap at
 * fractional widths between 767 and 768.
 */
export function isInstalledPhone(): boolean {
  if (typeof window === "undefined") return false
  return document.documentElement.hasAttribute(INSTALLED_APP_ATTRIBUTE) && !window.matchMedia("(min-width: 48rem)").matches
}
