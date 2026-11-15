// What a test needs to find the element with a snapshot ref again, without our temporary ref:
// role and accessible name, label, placeholder, test id, id. Called as `(DESCRIBE)(ref)`.
(ref) => {
  const el = document.querySelector(`[data-silence-ref="${CSS.escape(ref)}"]`);
  if (!el) return null;
  const t = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const text = (s) => String(s || "").replace(/\s+/g, " ").trim();
  let role = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
  if (!role) {
    if (t === "a" && el.hasAttribute("href")) role = "link";
    else if (t === "button" || t === "summary" || (t === "input" && /^(submit|button|reset|image)$/.test(type))) role = "button";
    else if (t === "input" && type === "checkbox") role = "checkbox";
    else if (t === "input" && type === "radio") role = "radio";
    else if (t === "input" && type === "number") role = "spinbutton";
    else if (t === "input" && type === "search") role = "searchbox";
    else if (t === "select") role = el.multiple ? "listbox" : "combobox";
    else if (t === "textarea" || (t === "input" && !/^(hidden|range|file|color)$/.test(type))) role = "textbox";
    else if (/^h[1-6]$/.test(t)) role = "heading";
  }
  let label = "";
  const by = el.getAttribute("aria-labelledby");
  if (by) label = text(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" "));
  if (!label) label = text(el.getAttribute("aria-label"));
  if (!label && el.labels && el.labels.length) label = text(Array.from(el.labels).map((l) => l.innerText).join(" "));
  const field = /^(textbox|searchbox|spinbutton|combobox|listbox)$/.test(role);
  let name = label;
  if (!name && t === "input" && /^(submit|button|reset)$/.test(type)) name = text(el.value);
  if (!name && !field) name = text(el.innerText || el.textContent);
  if (!name) name = text(el.getAttribute("title"));
  return {
    role,
    name: name.slice(0, 200),
    label: label.slice(0, 200),
    placeholder: text(el.getAttribute("placeholder")),
    testid: el.getAttribute("data-testid") || el.getAttribute("data-test-id") || el.getAttribute("data-test") || "",
    id: el.id || "",
    tag: t,
  };
}
