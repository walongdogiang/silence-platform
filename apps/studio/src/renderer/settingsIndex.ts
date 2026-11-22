import type { MsgKey, T } from "./i18n";
import type { NetworkTab } from "./networkTabs";

/** Left-column sections of the Settings dialog. */
export type SettingsSection =
  | "general"
  | "appearance"
  | "chat"
  | "profile"
  | "notifications"
  | "permissions"
  | "models"
  | "tools"
  | "data"
  | "shortcuts"
  | "about";

export const SECTIONS: { id: SettingsSection; label: MsgKey }[] = [
  { id: "general", label: "settings.general" },
  { id: "appearance", label: "settings.appearance" },
  { id: "chat", label: "settings.chat" },
  { id: "profile", label: "settings.profile" },
  { id: "notifications", label: "settings.notifications" },
  { id: "permissions", label: "settings.permissions" },
  { id: "models", label: "settings.models" },
  { id: "tools", label: "settings.tools" },
  { id: "data", label: "settings.data" },
  { id: "shortcuts", label: "settings.shortcuts" },
  { id: "about", label: "settings.about" },
];

export function isSettingsSection(v: unknown): v is SettingsSection {
  return SECTIONS.some((s) => s.id === v);
}

const KEY = "silence.settings.section";

export function loadSettingsSection(): SettingsSection {
  try {
    const v = localStorage.getItem(KEY);
    return isSettingsSection(v) ? v : "general";
  } catch {
    return "general";
  }
}

export function saveSettingsSection(s: SettingsSection) {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* storage blocked: Settings opens on General next time */
  }
}

/**
 * One searchable setting. `id` matches `data-setting` on its row; `tab` opens that Models tab.
 * `keywords` are extra words in both languages (searched as-is, whatever the UI language).
 */
export type SettingEntry = {
  id: string;
  section: SettingsSection;
  label: MsgKey;
  desc?: MsgKey;
  tab?: NetworkTab;
  keywords?: string;
};

export const SETTINGS_INDEX: SettingEntry[] = [
  { id: "lang", section: "general", label: "appear.language", desc: "set.lang.desc", keywords: "language ngôn ngữ tiếng việt english" },
  { id: "default-source", section: "general", label: "src.default", desc: "set.defaultSource.desc", keywords: "source nguồn provider" },
  { id: "max-concurrent", section: "general", label: "gen.concurrent", desc: "gen.concurrent.desc", keywords: "parallel concurrent queue song song cùng lúc hàng đợi worktree" },
  { id: "restore-tabs", section: "general", label: "gen.restore", desc: "gen.restore.desc", keywords: "startup restore tabs khởi động mở lại tab" },
  { id: "theme", section: "appearance", label: "appear.theme", desc: "appear.theme.desc", keywords: "dark light tối sáng" },
  { id: "palette", section: "appearance", label: "appear.palette", desc: "appear.palette.desc", keywords: "color màu palette" },
  { id: "accent", section: "appearance", label: "appear.accent", desc: "appear.accent.desc", keywords: "accent màu nhấn color" },
  { id: "density", section: "appearance", label: "appear.density", desc: "appear.density.desc", keywords: "spacing compact khoảng cách" },
  { id: "background", section: "appearance", label: "appear.background", desc: "appear.background.desc", keywords: "wallpaper hình nền" },
  { id: "code-font", section: "appearance", label: "code.font", desc: "code.font.desc", keywords: "font editor terminal monospace phông chữ" },
  { id: "code-size", section: "appearance", label: "code.size", desc: "code.size.desc", keywords: "font size zoom cỡ chữ editor terminal" },
  { id: "code-minimap", section: "appearance", label: "code.minimap", desc: "code.minimap.desc", keywords: "minimap editor" },
  { id: "chat-view", section: "chat", label: "chat.view", desc: "chat.view.desc", keywords: "transcript thinking verbose suy nghĩ chi tiết tool" },
  { id: "chat-style", section: "chat", label: "chat.style", desc: "chat.style.desc", keywords: "style concise explanatory output phong cách ngắn gọn giải thích" },
  { id: "chat-title", section: "chat", label: "chat.autoTitle", desc: "chat.autoTitle.desc", keywords: "title rename tên chat" },
  { id: "profile-main", section: "profile", label: "profile.main", desc: "set.profile.desc", keywords: "profile hồ sơ silence convention quy ước" },
  { id: "profile-project", section: "profile", label: "profile.projectNone", desc: "set.profile.desc", keywords: "project profile hồ sơ dự án" },
  { id: "profile-plugin", section: "profile", label: "profile.plugin", desc: "set.profile.desc", keywords: "plugin skill kỹ năng" },
  { id: "notif-permission", section: "notifications", label: "notif.permission", desc: "notif.permission.desc", keywords: "notification approve thông báo duyệt" },
  { id: "notif-done", section: "notifications", label: "notif.done", desc: "notif.done.desc", keywords: "notification done finished thông báo xong" },
  { id: "notif-flash", section: "notifications", label: "notif.flash", desc: "notif.flash.desc", keywords: "taskbar flash nháy" },
  { id: "notif-awake", section: "notifications", label: "notif.keepAwake", desc: "notif.keepAwake.desc", keywords: "sleep awake power ngủ thức" },
  { id: "notif-test", section: "notifications", label: "notif.test", desc: "notif.test.desc", keywords: "test notification thử thông báo" },
  { id: "mcp-servers", section: "tools", label: "mcp.servers", desc: "mcp.servers.desc", keywords: "mcp server tool plugin công cụ" },
  { id: "data-retention", section: "data", label: "data.retention", desc: "data.retention.desc", keywords: "history retention delete days lịch sử xoá ngày" },
  { id: "data-clear", section: "data", label: "data.clear", desc: "data.clear.desc", keywords: "clear delete history privacy xoá lịch sử riêng tư" },
  { id: "data-dir", section: "data", label: "data.dir", desc: "data.dir.desc", keywords: "folder logs audit thư mục" },
  { id: "appearance-reset", section: "appearance", label: "appear.reset", desc: "appear.resetDesc", keywords: "reset đặt lại default mặc định" },
  { id: "blur", section: "appearance", label: "appear.blur", desc: "appear.blur.desc", keywords: "blur mờ" },
  { id: "motion", section: "appearance", label: "appear.reduceMotion", desc: "appear.reduceMotion.desc", keywords: "animation hiệu ứng chuyển động" },
  { id: "perm-mode", section: "permissions", label: "perms.mode", desc: "perms.mode.desc", keywords: "permission quyền ask manual accept edits auto bypass chế độ" },
  { id: "perm-bypass", section: "permissions", label: "perms.bypass", desc: "perms.bypass.desc", keywords: "bypass yolo skip permissions bỏ qua quyền" },
  { id: "perm-rules", section: "permissions", label: "perms.rules", desc: "perms.rules.desc", keywords: "rules allow deny ask luật cho phép từ chối" },
  { id: "perm-sandbox", section: "permissions", label: "sandbox.title", desc: "sandbox.desc", keywords: "sandbox autonomous tự chủ cài install uac cách ly" },
  { id: "perm-network", section: "permissions", label: "sandbox.net.title", desc: "sandbox.net.desc", keywords: "network mạng domain host allowlist registry npm" },
  { id: "perm-remembered", section: "permissions", label: "perms.remembered", desc: "perms.remembered.desc", keywords: "allow cho phép nhớ" },
  { id: "models-sources", section: "models", tab: "sources", label: "net.tab.sources", desc: "set.models.sources.desc", keywords: "api key openrouter claude cli" },
  { id: "models-auto", section: "models", tab: "auto", label: "net.tab.auto", desc: "set.models.auto.desc", keywords: "auto preset slot spend cap chi phí" },
  { id: "models-list", section: "models", tab: "models", label: "net.tab.models", desc: "set.models.list.desc", keywords: "model picker bật tắt enable" },
  { id: "shortcuts", section: "shortcuts", label: "settings.shortcuts", desc: "set.shortcuts.desc", keywords: "keyboard phím tắt hotkey" },
  { id: "about", section: "about", label: "settings.about", desc: "set.about.desc", keywords: "version phiên bản engine" },
];

/** Lower-case, no Vietnamese diacritics ("Màu nhấn" → "mau nhan"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Entries whose label, description or keywords contain every word of `query`. */
export function searchSettings(query: string, t: T, index: SettingEntry[] = SETTINGS_INDEX): SettingEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return index.filter((e) => {
    const hay = fold([t(e.label), e.desc ? t(e.desc) : "", e.keywords ?? ""].join(" "));
    return words.every((w) => hay.includes(w));
  });
}
