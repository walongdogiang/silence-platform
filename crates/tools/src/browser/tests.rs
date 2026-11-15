use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Real-browser tests run one at a time: several cold browser starts at once make CI flaky.
static ONE_BROWSER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[test]
fn diff_shows_only_changed_lines() {
    let a: Vec<String> = ["- heading \"Cart\"", "- button \"Add\" [ref=e1]", "- text: 0 items"].map(String::from).to_vec();
    let mut b = a.clone();
    b[2] = "- text: 1 item".into();
    assert_eq!(diff_lines(&a, &b).unwrap(), "- text: 0 items\n+ text: 1 item\n");
    assert_eq!(diff_lines(&a, &a).unwrap(), "");
    // Mostly new page: show it whole.
    let c: Vec<String> = (0..10).map(|i| format!("- text: {i}")).collect();
    assert!(diff_lines(&a, &c).is_none());
    assert!(diff_lines(&[], &a).is_none());
}

#[test]
fn keys() {
    assert_eq!(key_info("Enter").unwrap(), ("Enter".into(), 13, "\r".into()));
    assert_eq!(key_info("esc").unwrap().1, 27);
    assert_eq!(key_info("a").unwrap(), ("KeyA".into(), 65, "a".into()));
    assert_eq!(key_info("7").unwrap().0, "Digit7");
    assert!(key_info("Ctrl+Q").is_none());
}

const PAGE: &str = r#"<!doctype html><html><head><title>Cart</title></head><body>
<h1>Your cart</h1>
<label for="q">Qty</label><input id="q" value="1">
<select id="s" aria-label="Fruit"><option value="a">Apple</option><option value="p">Pear</option></select>
<button id="add" onclick="document.getElementById('out').textContent = 'Added ' + document.getElementById('q').value + ' ' + document.getElementById('s').selectedOptions[0].text">Add</button>
<button id="bad" onclick="window.cart.items.push(1)">Broken</button>
<button style="display:none">Hidden</button>
<p id="out"></p>
<img src="/missing.png" alt="logo">
<script>console.warn('hello warn')</script>
</body></html>"#;

/// Serves PAGE at `/` and 404 elsewhere, for any number of requests.
async fn serve() -> String {
    serve_with(|_| None).await
}

/// Like `serve`, but `extra(path)` can answer other paths with (content-type, body, cacheable).
async fn serve_with(extra: fn(&str) -> Option<(&'static str, String, bool)>) -> String {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut s, _)) = l.accept().await else { break };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req.split_whitespace().nth(1).unwrap_or("/");
                let (status, ctype, body, cache) = match (path, extra(path)) {
                    ("/", _) => ("200 OK", "text/html", PAGE.to_string(), false),
                    (_, Some((ctype, body, cache))) => ("200 OK", ctype, body, cache),
                    _ => ("404 Not Found", "text/html", "nope".to_string(), false),
                };
                let cache = if cache { "cache-control: max-age=3600\r\n" } else { "" };
                let resp = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: {ctype}\r\n{cache}content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes()).await;
                let _ = s.shutdown().await;
            });
        }
    });
    format!("http://127.0.0.1:{port}/")
}

fn ref_of(text: &str, needle: &str) -> String {
    let line = text.lines().find(|l| l.contains(needle)).unwrap_or_else(|| panic!("no `{needle}` in:\n{text}"));
    let start = line.find("[ref=").unwrap() + 5;
    line[start..].split(']').next().unwrap().to_string()
}

/// Real browser end to end. Skips (passes) when no Chromium browser is installed.
#[tokio::test]
async fn open_fill_select_click_console_network() {
    if find_browser().is_none() {
        eprintln!("skip: {NO_BROWSER}");
        return;
    }
    let _one = ONE_BROWSER.lock().await;
    let url = serve().await;
    let b = Browser::launch(|s| s.to_string()).await.expect("launch");
    let r = b.open(&url).await.unwrap();
    assert!(r.ok, "{}", r.text);
    assert!(r.text.contains("title: Cart"), "{}", r.text);
    assert!(r.text.contains("heading \"Your cart\" [level=1]"), "{}", r.text);
    assert!(r.text.contains("textbox \"Qty\""), "{}", r.text);
    assert!(!r.text.contains("Hidden"), "hidden elements stay out:\n{}", r.text);
    let qty = ref_of(&r.text, "textbox \"Qty\"");
    let fruit = ref_of(&r.text, "combobox \"Fruit\"");
    let add = ref_of(&r.text, "button \"Add\"");
    let bad = ref_of(&r.text, "button \"Broken\"");

    b.act(&qty, "fill", "3").await.unwrap();
    let r = b.act(&fruit, "select", "pear").await.unwrap();
    assert!(r.text.contains("selected \"Pear\""), "{}", r.text);
    let r = b.act(&add, "click", "").await.unwrap();
    assert!(r.text.contains("+ text: Added 3 Pear"), "diff shows the new text:\n{}", r.text);

    // The flow so far, as a Playwright test.
    let code = flow::render_test(&b.flow(), "add pear", true, None);
    assert!(code.contains("await expect(page).toHaveTitle(\"Cart\");"), "{code}");
    assert!(code.contains("page.getByLabel(\"Qty\", { exact: true }).fill(\"3\")"), "{code}");
    assert!(code.contains("page.getByLabel(\"Fruit\", { exact: true }).selectOption(\"pear\")"), "{code}");
    assert!(code.contains("page.getByRole(\"button\", { name: \"Add\", exact: true }).click()"), "{code}");
    assert!(code.contains("expect(page.getByText(\"Added 3 Pear\")).toBeVisible()"), "{code}");

    let r = b.act(&bad, "click", "").await.unwrap();
    assert!(r.text.contains("console: 1 new error"), "{}", r.text);
    let c = b.console(0, "error");
    assert!(c.contains("TypeError") && c.contains("reading 'items'"), "{c}");
    assert_eq!(c.matches(":6:66").count(), 1, "stack location once:
{c}");
    assert!(b.console(0, "warning").contains("hello warn"));
    let n = b.network(0);
    assert!(n.contains("/missing.png → 404"), "{n}");
    assert!(!n.contains("favicon"), "{n}");

    let shot = b.screenshot("", false).await.unwrap();
    assert!(shot.data_url.starts_with("data:image/png;base64,iVBOR"), "png");
    assert_eq!((shot.width, shot.height), VIEWPORT, "fixed viewport");
    let part = b.screenshot(&add, false).await.unwrap();
    assert!(part.width < 200 && part.height < 100, "element shot is small: {}x{}", part.width, part.height);
    assert!(b.screenshot("e999", false).await.is_err());
    let v = b.view().await;
    assert_eq!(v.title, "Cart");
    assert!(v.frame.as_deref().is_some_and(|f| f.starts_with("data:image/jpeg;base64,")));
    assert_eq!((v.errors, v.failed), (1, 1));

    let r = b.act("e999", "click", "").await.unwrap();
    assert!(!r.ok && r.text.contains("no element with ref e999"), "{}", r.text);
    let r = b.snapshot(false).await.unwrap();
    assert!(r.text.contains("no visible change"), "{}", r.text);
}

/// The agent edits a script and reloads: it must see the new one even if the server said
/// "cache for an hour".
#[tokio::test]
async fn reload_never_uses_a_cached_script() {
    if find_browser().is_none() {
        return;
    }
    let _one = ONE_BROWSER.lock().await;
    static VERSION: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    let base = serve_with(|path| match path {
        "/v.html" => Some(("text/html", "<title>V</title><p id=v></p><script src=\"/v.js\"></script>".into(), false)),
        "/v.js" => {
            let n = VERSION.load(std::sync::atomic::Ordering::SeqCst);
            Some(("text/javascript", format!("document.getElementById('v').textContent = 'version {n}'"), true))
        }
        _ => None,
    })
    .await;
    let b = Browser::launch(|s| s.to_string()).await.expect("launch");
    let r = b.open(&format!("{base}v.html")).await.unwrap();
    assert!(r.text.contains("version 1"), "{}", r.text);
    VERSION.store(2, std::sync::atomic::Ordering::SeqCst);
    let r = b.open(&format!("{base}v.html")).await.unwrap();
    assert!(r.text.contains("version 2"), "cached script used:\n{}", r.text);
}

#[tokio::test]
async fn closed_port_is_reported() {
    if find_browser().is_none() {
        return;
    }
    let _one = ONE_BROWSER.lock().await;
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    let b = Browser::launch(|s| s.to_string()).await.expect("launch");
    let r = b.open(&format!("http://127.0.0.1:{port}/")).await.unwrap();
    // The freed port can be handed to a server of a test running in parallel; then there is nothing to check.
    if r.ok {
        eprintln!("skip: port {port} was reused");
        return;
    }
    assert!(r.text.contains("CONNECTION_REFUSED"), "{}", r.text);
}
