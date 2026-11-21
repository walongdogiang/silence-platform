import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext, translator } from "../../i18n";
import { searchSettings } from "../../settingsIndex";
import { fileText, ProfileView, type ProfileStatus } from "./ProfileSection";

const vi = translator("vi");
const html = (status: ProfileStatus, workspace = "D:/w/shop") =>
  renderToStaticMarkup(
    <LangContext.Provider value="vi">
      <ProfileView load={{ state: "ok", status }} workspace={workspace} />
    </LangContext.Provider>,
  );

const full: ProfileStatus = {
  home: "C:\\Users\\me\\.silence",
  profile: { path: "C:\\Users\\me\\.silence\\profile.md", lines: 28, loaded: true },
  project: null,
  projectName: "shop",
  plugin: { path: "C:\\Users\\me\\.silence\\plugin", name: "silence-personal", skills: ["pr-flow", "verify"], loaded: true },
  warnings: [],
};

describe("ProfileView", () => {
  it("shows the profile, where to create the project profile, and the plugin skills", () => {
    const out = html(full);
    expect(out).toContain("profile.md · 28 dòng · gửi kèm mọi chat");
    expect(out).toContain("Hồ sơ project (shop)");
    expect(out).toContain("Chưa có file: C:\\Users\\me\\.silence\\projects\\shop\\profile.md");
    expect(out).toContain("silence-personal · skill: pr-flow, verify");
    expect(out).not.toContain("Cảnh báo");
  });

  it("lists warnings and marks files that were not loaded", () => {
    const out = html({ ...full, profile: { ...full.profile!, loaded: false }, warnings: ["profile.md có thứ trông như secret"] });
    expect(out).toContain("không nạp (xem Cảnh báo)");
    expect(out).toContain("<li>profile.md có thứ trông như secret</li>");
  });

  it("says the core is needed when it is off", () => {
    expect(html({ available: false })).toContain("SILENCE_CORE=1");
  });
});

describe("profile settings", () => {
  it("fileText covers missing, empty and loaded files", () => {
    expect(fileText(vi, null, "/h/profile.md")).toBe("Chưa có file: /h/profile.md");
    expect(fileText(vi, { path: "/h/p.md", lines: 0, loaded: false }, "")).toBe("/h/p.md · trống");
  });

  it("is reachable from the settings search", () => {
    expect(searchSettings("hồ sơ", vi).some((e) => e.section === "profile")).toBe(true);
    expect(searchSettings("skill", vi).some((e) => e.id === "profile-plugin")).toBe(true);
  });
});
