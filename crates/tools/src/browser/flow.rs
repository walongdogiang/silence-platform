//! The flow the agent just checked in its browser (open, fill, click, what showed up) and how to
//! turn it into a Playwright test of the user's project. Locators follow Playwright's advice:
//! test id, then role + accessible name, then label, placeholder, id. Never our temporary refs.

use serde::Deserialize;
use std::path::Path;

/// An element as a test can find it again.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Target {
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub placeholder: String,
    #[serde(default)]
    pub testid: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub tag: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Goto(String),
    Title(String),
    Click(Target),
    Fill(Target, String),
    Select(Target, String),
    Press(Option<Target>, String),
    Hover(Target),
    /// Text that appeared after an action (from the snapshot diff).
    SeeText(String),
    SeeHeading(String),
}

/// At most this many expectations are drawn from one action's diff.
const EXPECTS_PER_STEP: usize = 3;

/// Expectations from a report's "changes" section: added text and headings.
pub fn expectations(report: &str) -> Vec<Step> {
    let mut out = Vec::new();
    let mut in_diff = false;
    for line in report.lines() {
        if line.starts_with("--- changes since last snapshot") {
            in_diff = true;
            continue;
        }
        if line.starts_with("--- ") {
            in_diff = false;
            continue;
        }
        if !in_diff || out.len() >= EXPECTS_PER_STEP {
            continue;
        }
        let Some(added) = line.strip_prefix("+ ") else { continue };
        let added = added.trim_start().trim_start_matches("- ");
        if let Some(t) = added.strip_prefix("text: ") {
            let t = t.trim_end_matches('…').trim();
            if t.chars().count() >= 2 {
                out.push(Step::SeeText(t.to_string()));
            }
        } else if let Some(rest) = added.strip_prefix("heading \"") {
            if let Some(name) = rest.split('"').next().filter(|n| !n.is_empty() && !n.ends_with('…')) {
                out.push(Step::SeeHeading(name.to_string()));
            }
        }
    }
    out
}

/// Roles Playwright's `getByRole` knows and our recorder produces.
const ROLES: [&str; 14] = [
    "button", "link", "checkbox", "radio", "textbox", "searchbox", "spinbutton", "combobox", "listbox", "tab", "menuitem",
    "option", "switch", "heading",
];

/// A JS string literal (double quotes, escaped).
fn q(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

pub fn locator(t: &Target) -> String {
    let field = matches!(t.role.as_str(), "textbox" | "searchbox" | "spinbutton" | "combobox" | "listbox");
    if !t.testid.is_empty() {
        return format!("page.getByTestId({})", q(&t.testid));
    }
    if field && !t.label.is_empty() {
        return format!("page.getByLabel({}, {{ exact: true }})", q(&t.label));
    }
    if ROLES.contains(&t.role.as_str()) && !t.name.is_empty() {
        return format!("page.getByRole({}, {{ name: {}, exact: true }})", q(&t.role), q(&t.name));
    }
    if !t.label.is_empty() {
        return format!("page.getByLabel({}, {{ exact: true }})", q(&t.label));
    }
    if !t.placeholder.is_empty() {
        return format!("page.getByPlaceholder({}, {{ exact: true }})", q(&t.placeholder));
    }
    if !t.id.is_empty() {
        return format!("page.locator({})", q(&format!("#{}", t.id)));
    }
    // Nothing stable to hold on to: a visible TODO beats a selector that breaks silently.
    format!("page.locator({}) /* TODO: give this element a label or data-testid */", q(if t.tag.is_empty() { "body" } else { &t.tag }))
}

/// Where the project's Playwright lives.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Playwright {
    /// Config file relative to the workspace (`playwright.config.ts`), empty when only the package is there.
    pub config: String,
    pub test_dir: Option<String>,
    pub base_url: Option<String>,
    pub typescript: bool,
}

/// Playwright in the workspace root: a `playwright.config.*` or `@playwright/test` in package.json.
pub fn detect_playwright(root: &Path) -> Option<Playwright> {
    let config = ["playwright.config.ts", "playwright.config.mts", "playwright.config.js", "playwright.config.mjs", "playwright.config.cjs"]
        .into_iter()
        .find(|f| root.join(f).is_file());
    let in_package = std::fs::read_to_string(root.join("package.json"))
        .ok()
        .is_some_and(|p| p.contains("\"@playwright/test\""));
    if config.is_none() && !in_package {
        return None;
    }
    let text = config.and_then(|c| std::fs::read_to_string(root.join(c)).ok()).unwrap_or_default();
    let field = |key: &str| {
        regex::Regex::new(&format!(r#"\b{key}\s*:\s*['"`]([^'"`]+)['"`]"#))
            .ok()
            .and_then(|re| re.captures(&text).map(|c| c[1].to_string()))
    };
    let typescript = config.is_some_and(|c| c.ends_with("ts")) || (config.is_none() && root.join("tsconfig.json").is_file());
    Some(Playwright {
        config: config.unwrap_or("").to_string(),
        test_dir: field("testDir").map(|d| d.trim_start_matches("./").trim_end_matches('/').to_string()),
        base_url: field("baseURL"),
        typescript,
    })
}

/// Vietnamese (and common Latin) letters without their marks: `Thêm món` → `Them mon`.
fn fold(c: char) -> char {
    const GROUPS: [(&str, char); 14] = [
        ("àáảãạăằắẳẵặâầấẩẫậä", 'a'),
        ("ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÄ", 'A'),
        ("èéẻẽẹêềếểễệë", 'e'),
        ("ÈÉẺẼẸÊỀẾỂỄỆË", 'E'),
        ("ìíỉĩịï", 'i'),
        ("ÌÍỈĨỊÏ", 'I'),
        ("òóỏõọôồốổỗộơờớởỡợö", 'o'),
        ("ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÖ", 'O'),
        ("ùúủũụưừứửữựü", 'u'),
        ("ÙÚỦŨỤƯỪỨỬỮỰÜ", 'U'),
        ("ỳýỷỹỵ", 'y'),
        ("ỲÝỶỸỴ", 'Y'),
        ("đ", 'd'),
        ("Đ", 'D'),
    ];
    GROUPS.iter().find(|(set, _)| set.contains(c)).map(|(_, base)| *base).unwrap_or(c)
}

/// File name for a test titled `title` (`add-item-to-cart`).
pub fn slug(title: &str) -> String {
    let mut s = String::new();
    for c in title.chars().map(fold) {
        if c.is_ascii_alphanumeric() {
            s.push(c.to_ascii_lowercase());
        } else if !s.ends_with('-') && !s.is_empty() {
            s.push('-');
        }
    }
    let s = s.trim_end_matches('-').chars().take(48).collect::<String>();
    if s.is_empty() { "flow".into() } else { s }
}

/// Playwright test source for `steps`. With a `base_url`, same-origin addresses become paths.
pub fn render_test(steps: &[Step], title: &str, typescript: bool, base_url: Option<&str>) -> String {
    let mut body = Vec::new();
    for s in steps {
        let line = match s {
            Step::Goto(url) => {
                let target = match base_url.map(|b| b.trim_end_matches('/')) {
                    Some(b) if !b.is_empty() && url.starts_with(b) => {
                        let path = &url[b.len()..];
                        if path.is_empty() { "/".to_string() } else { path.to_string() }
                    }
                    _ => url.clone(),
                };
                format!("await page.goto({});", q(&target))
            }
            Step::Title(t) => format!("await expect(page).toHaveTitle({});", q(t)),
            Step::Click(t) => format!("await {}.click();", locator(t)),
            Step::Fill(t, v) => format!("await {}.fill({});", locator(t), q(v)),
            Step::Select(t, v) => format!("await {}.selectOption({});", locator(t), q(v)),
            Step::Press(Some(t), k) => format!("await {}.press({});", locator(t), q(k)),
            Step::Press(None, k) => format!("await page.keyboard.press({});", q(k)),
            Step::Hover(t) => format!("await {}.hover();", locator(t)),
            Step::SeeText(t) => format!("await expect(page.getByText({})).toBeVisible();", q(t)),
            Step::SeeHeading(h) => format!("await expect(page.getByRole(\"heading\", {{ name: {} }})).toBeVisible();", q(h)),
        };
        body.push(format!("  {line}"));
    }
    let import = if typescript {
        "import { test, expect } from \"@playwright/test\";"
    } else {
        "const { test, expect } = require(\"@playwright/test\");"
    };
    format!("{import}\n\ntest({}, async ({{ page }}) => {{\n{}\n}});\n", q(title), body.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(role: &str, name: &str) -> Target {
        Target { role: role.into(), name: name.into(), ..Default::default() }
    }

    #[test]
    fn locators_prefer_test_id_role_label() {
        let mut b = t("button", "Add");
        assert_eq!(locator(&b), r#"page.getByRole("button", { name: "Add", exact: true })"#);
        b.testid = "add-btn".into();
        assert_eq!(locator(&b), r#"page.getByTestId("add-btn")"#);
        let qty = Target { role: "spinbutton".into(), label: "Qty".into(), name: "Qty".into(), ..Default::default() };
        assert_eq!(locator(&qty), r#"page.getByLabel("Qty", { exact: true })"#);
        let search = Target { role: "textbox".into(), placeholder: "Search…".into(), ..Default::default() };
        assert_eq!(locator(&search), r#"page.getByPlaceholder("Search…", { exact: true })"#);
        let bare = Target { tag: "div".into(), ..Default::default() };
        assert!(locator(&bare).contains("TODO"));
        assert_eq!(locator(&t("button", "Say \"hi\"")), r#"page.getByRole("button", { name: "Say \"hi\"", exact: true })"#);
    }

    #[test]
    fn expectations_come_from_added_text() {
        let report = "clicked e4\nurl: x\n--- changes since last snapshot (- removed, + added) ---\n- text: 0 items\n+ text: 1 item\n+   - text: Apple × 3\n+ heading \"Done\" [level=2]\n+ button \"Undo\" [ref=e9]\n";
        assert_eq!(
            expectations(report),
            vec![Step::SeeText("1 item".into()), Step::SeeText("Apple × 3".into()), Step::SeeHeading("Done".into())]
        );
        assert!(expectations("--- page (use [ref=…] with browser_act) ---\n- text: hi\n").is_empty());
    }

    #[test]
    fn renders_a_test_with_relative_paths() {
        let steps = vec![
            Step::Goto("http://127.0.0.1:8770/cart".into()),
            Step::Title("Cart".into()),
            Step::Fill(Target { role: "spinbutton".into(), label: "Qty".into(), ..Default::default() }, "3".into()),
            Step::Click(t("button", "Add")),
            Step::Press(None, "Enter".into()),
            Step::SeeText("Added 3".into()),
        ];
        let code = render_test(&steps, "Add to cart", true, Some("http://127.0.0.1:8770/"));
        assert_eq!(
            code,
            r#"import { test, expect } from "@playwright/test";

test("Add to cart", async ({ page }) => {
  await page.goto("/cart");
  await expect(page).toHaveTitle("Cart");
  await page.getByLabel("Qty", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added 3")).toBeVisible();
});
"#
        );
        assert!(render_test(&steps, "x", false, None).starts_with("const { test, expect } = require("));
        assert!(render_test(&steps, "x", false, None).contains("page.goto(\"http://127.0.0.1:8770/cart\")"));
    }

    #[test]
    fn detects_playwright_config() {
        let dir = tempfile::tempdir().unwrap();
        assert!(detect_playwright(dir.path()).is_none());
        std::fs::write(
            dir.path().join("playwright.config.ts"),
            "export default defineConfig({ testDir: './e2e', use: { baseURL: \"http://localhost:5173\" } });",
        )
        .unwrap();
        let pw = detect_playwright(dir.path()).unwrap();
        assert_eq!(pw.config, "playwright.config.ts");
        assert_eq!(pw.test_dir.as_deref(), Some("e2e"));
        assert_eq!(pw.base_url.as_deref(), Some("http://localhost:5173"));
        assert!(pw.typescript);
        let only_pkg = tempfile::tempdir().unwrap();
        std::fs::write(only_pkg.path().join("package.json"), r#"{"devDependencies":{"@playwright/test":"^1.56.0"}}"#).unwrap();
        let pw = detect_playwright(only_pkg.path()).unwrap();
        assert_eq!((pw.config.as_str(), pw.typescript), ("", false));
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Add item to cart!"), "add-item-to-cart");
        assert_eq!(slug("Thêm món vào giỏ"), "them-mon-vao-gio");
        assert_eq!(slug("…"), "flow");
    }
}
