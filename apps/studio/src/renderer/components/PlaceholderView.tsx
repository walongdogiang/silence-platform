import { useT } from "../i18n";

/** Stub view for a tab without a backend; `title` is already in the UI language. */
export function PlaceholderView({ title, detail }: { title: string; detail?: string }) {
  const t = useT();
  return (
    <div className="placeholder">
      <h2>{title}</h2>
      <p>{detail ?? t("review.stub")}</p>
    </div>
  );
}
