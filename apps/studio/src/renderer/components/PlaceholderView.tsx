const LABELS: Record<string, string> = {
  home: "Home",
  initiatives: "Initiatives",
  tasks: "Tasks",
  agents: "AI Agents",
  knowledge: "Knowledge",
  decisions: "Decisions",
  tests: "Tests",
  deploy: "Deploy",
  services: "External Services",
};

export function PlaceholderView({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="placeholder">
      <h2>{LABELS[title] ?? title}</h2>
      <p>{detail ?? "Chưa kết nối backend — UI only. Không có dữ liệu thật."}</p>
    </div>
  );
}
