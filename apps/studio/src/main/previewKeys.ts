/** Key info from Electron's `before-input-event` (only the fields we read). */
export type KeyInput = { type: string; control: boolean; shift: boolean; alt: boolean; meta: boolean; code: string };

/** App shortcuts that must still work while the Preview page has focus (the view swallows keys otherwise). */
export function forwardedShortcut(input: KeyInput): boolean {
  if (input.type !== "keyDown" || input.meta) return false;
  const { control: c, shift: s, alt: a, code } = input;
  if (c && !s && !a && code === "KeyJ") return true; // toggle pane column
  if (c && s && !a && code === "KeyB") return true; // Preview tab
  if (c && !s && a && code === "KeyU") return true; // history rail
  return false;
}
