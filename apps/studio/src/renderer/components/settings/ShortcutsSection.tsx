import { Fragment } from "react";
import { useT, type MsgKey } from "../../i18n";

/** Read-only list of the shortcuts that exist in the code today. Keys are not translated. */
const GROUPS: { title: MsgKey; items: { keys: string[][]; label: MsgKey }[] }[] = [
  {
    title: "kb.group.general",
    items: [
      { keys: [["Ctrl", "J"]], label: "kb.panel" },
      { keys: [["Ctrl", "Alt", "U"]], label: "kb.history" },
      { keys: [["Ctrl", "Shift", "E"]], label: "kb.evals" },
      { keys: [["Esc"]], label: "kb.closeDialog" },
    ],
  },
  {
    title: "kb.group.composer",
    items: [
      { keys: [["Enter"]], label: "kb.send" },
      { keys: [["Shift", "Enter"]], label: "kb.newline" },
      { keys: [["Ctrl", "V"]], label: "kb.pasteImage" },
      { keys: [["/"]], label: "kb.skill" },
      { keys: [["@"]], label: "kb.context" },
    ],
  },
  {
    title: "kb.group.history",
    items: [
      { keys: [["P"]], label: "kb.pin" },
      { keys: [["U"]], label: "kb.unread" },
      { keys: [["R"]], label: "kb.rename" },
      { keys: [["F"]], label: "kb.fork" },
      { keys: [["A"]], label: "kb.archive" },
      { keys: [["D"]], label: "kb.delete" },
    ],
  },
  {
    title: "kb.group.images",
    items: [
      { keys: [["←"], ["→"]], label: "kb.prevNext" },
      { keys: [["Esc"]], label: "kb.closeImage" },
    ],
  },
  {
    title: "kb.group.settings",
    items: [{ keys: [["Ctrl", "S"]], label: "kb.saveModels" }],
  },
];

export function ShortcutsSection() {
  const t = useT();
  return (
    <div className="set-shortcuts" data-setting="shortcuts">
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h3>{t(g.title)}</h3>
          <dl>
            {g.items.map((it) => (
              <Fragment key={it.label}>
                <dt>{t(it.label)}</dt>
                <dd>
                  {it.keys.map((combo, i) => (
                    <span key={i} className="set-combo">
                      {i > 0 ? <span className="set-or">/</span> : null}
                      {combo.map((k, j) => (
                        <Fragment key={k}>
                          {j > 0 ? <span className="set-plus">+</span> : null}
                          <kbd>{k}</kbd>
                        </Fragment>
                      ))}
                    </span>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
