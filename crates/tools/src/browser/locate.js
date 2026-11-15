// Find the element with a snapshot ref, bring it into view, and say where to click.
// Called as `(LOCATE)(ref)`; returns { x, y, covered, disabled, tag, kind } or { error }.
(ref) => {
  const el = document.querySelector(`[data-silence-ref="${CSS.escape(ref)}"]`);
  if (!el) return { error: `no element with ref ${ref} on this page (take a new browser_snapshot)` };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  let covered = null;
  if (top && top !== el && !el.contains(top) && !top.contains(el)) {
    covered = top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") + (top.className && typeof top.className === "string" ? "." + top.className.trim().split(/\s+/)[0] : "");
  }
  const tag = el.tagName.toLowerCase();
  const kind = tag === "select" ? "select" : tag === "input" ? (el.type || "text").toLowerCase() : el.isContentEditable ? "editable" : tag;
  return { x, y, covered, disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true", tag, kind };
}
