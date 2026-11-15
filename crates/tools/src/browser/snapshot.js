// Text snapshot of the page for an agent: headings, text, and interactive elements with a ref
// (`data-silence-ref`, kept across snapshots so refs stay valid after small changes).
// Evaluated with Runtime.evaluate; returns { url, title, lines, truncated }.
(() => {
  const MAX_LINES = 400;
  const w = window;
  if (!w.__silenceRef) w.__silenceRef = 0;
  const clip = (s, n = 100) => {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const q = (s) => JSON.stringify(s);
  const visible = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.getClientRects().length > 0;
  };
  const INPUT_ROLE = {
    checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", image: "button",
    range: "slider", search: "searchbox", number: "spinbutton", file: "button", color: "button",
  };
  const INTERACTIVE = new Set([
    "link", "button", "checkbox", "radio", "slider", "searchbox", "textbox", "spinbutton", "combobox", "switch",
    "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "listbox",
  ]);
  const TEXT_INPUT = new Set(["textbox", "searchbox", "spinbutton", "combobox", "slider"]);
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0];
    const t = el.tagName.toLowerCase();
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "button" || t === "summary") return "button";
    if (t === "input") {
      const ty = (el.getAttribute("type") || "text").toLowerCase();
      return ty === "hidden" ? "hidden" : INPUT_ROLE[ty] || "textbox";
    }
    if (t === "textarea") return "textbox";
    if (t === "select") return el.multiple ? "listbox" : "combobox";
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "img") return "img";
    if (t === "dialog") return el.open ? "dialog" : "hidden";
    if (el.isContentEditable && el.getAttribute("contenteditable") !== null) return "textbox";
    return null;
  };
  const labelText = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (t.trim()) return t;
    }
    const al = el.getAttribute("aria-label");
    if (al) return al;
    if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.innerText).join(" ");
    return "";
  };
  const nameOf = (el, role) => {
    let n = labelText(el);
    if (!n && TEXT_INPUT.has(role)) n = el.getAttribute("placeholder") || el.getAttribute("name") || "";
    if (!n && el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type)) n = el.value || el.type;
    if (!n && el.tagName === "IMG") n = el.getAttribute("alt") || "";
    if (!n && !TEXT_INPUT.has(role)) n = el.innerText || el.textContent || "";
    if (!n) n = el.getAttribute("title") || "";
    return clip(n);
  };
  const refOf = (el) => {
    let r = el.getAttribute("data-silence-ref");
    if (!r) {
      r = "e" + ++w.__silenceRef;
      el.setAttribute("data-silence-ref", r);
    }
    return r;
  };
  const lines = [];
  let truncated = false;
  const push = (depth, s) => {
    if (lines.length >= MAX_LINES) {
      truncated = true;
      return;
    }
    lines.push("  ".repeat(Math.min(depth, 8)) + "- " + s);
  };
  const ownText = (el) =>
    clip(
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(" "),
      200,
    );
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"]);
  const walk = (el, depth) => {
    if (truncated || SKIP.has(el.tagName) || el.tagName.toLowerCase() === "svg") return;
    if (el.getAttribute("aria-hidden") === "true" || !visible(el)) return;
    const role = roleOf(el);
    if (role === "hidden" || role === "none" || role === "presentation") {
      if (role === "hidden") return;
    } else if (role && INTERACTIVE.has(role)) {
      const attrs = [];
      if (el.disabled || el.getAttribute("aria-disabled") === "true") attrs.push("disabled");
      if (role === "checkbox" || role === "radio" || role === "switch")
        attrs.push(el.checked || el.getAttribute("aria-checked") === "true" ? "checked" : "unchecked");
      if (el.tagName === "SELECT") {
        attrs.push("value=" + q(clip(el.selectedOptions[0]?.text || "", 60)));
        const opts = Array.from(el.options).slice(0, 12).map((o) => q(clip(o.text, 30)));
        attrs.push("options: " + opts.join(", ") + (el.options.length > 12 ? ", …" : ""));
      } else if (TEXT_INPUT.has(role) && "value" in el) attrs.push("value=" + q(clip(el.value, 60)));
      else if (role === "textbox" && el.isContentEditable) attrs.push("value=" + q(clip(el.innerText, 60)));
      const exp = el.getAttribute("aria-expanded");
      if (exp) attrs.push("expanded=" + exp);
      if (el.getAttribute("aria-selected") === "true") attrs.push("selected");
      if (role === "link") {
        const href = el.getAttribute("href") || "";
        if (href && !/^javascript:/i.test(href)) attrs.push("-> " + clip(href, 80));
      }
      if (el.required) attrs.push("required");
      if (el.validity && !el.validity.valid && el.validationMessage) attrs.push("invalid: " + q(clip(el.validationMessage, 60)));
      push(depth, `${role} ${q(nameOf(el, role))} [ref=${refOf(el)}]${attrs.length ? " " + attrs.join(" ") : ""}`);
      return;
    } else if (role === "heading") {
      const level = /^H([1-6])$/.exec(el.tagName)?.[1] || el.getAttribute("aria-level") || "";
      push(depth, `heading ${q(clip(el.innerText))}${level ? ` [level=${level}]` : ""}`);
      return;
    } else if (role === "img") {
      const alt = el.getAttribute("alt");
      if (alt) push(depth, `img ${q(clip(alt))}`);
      return;
    }
    let next = depth;
    if (role && /^(dialog|alertdialog|alert|status|form|navigation|main|table|list|tablist|menu|region|banner|contentinfo)$/.test(role)) {
      const label = clip(labelText(el), 60);
      push(depth, role + (label ? ` ${q(label)}` : "") + ":");
      next = depth + 1;
    }
    const t = ownText(el);
    if (t) push(next, "text: " + t);
    for (const c of el.children) walk(c, next);
    if (el.shadowRoot) for (const c of el.shadowRoot.children) walk(c, next);
  };
  if (document.body) walk(document.body, 0);
  return { url: location.href, title: document.title, lines, truncated };
})()
