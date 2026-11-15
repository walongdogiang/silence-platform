//! `http_check`: one HTTP request to the user's own app on this machine (loopback only), so the
//! agent can confirm a route works after a change without a browser or `curl` (which counts as
//! network access). Redirects are followed only while they stay on loopback; no proxy is used.

use crate::ToolOutput;
use anyhow::{anyhow, Result};
use regex::Regex;
use reqwest::{redirect, Method, Url};
use serde_json::Value;
use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Body bytes read from the wire at most.
const MAX_READ_BYTES: usize = 512 * 1024;
/// Body chars handed to the model at most.
const MAX_BODY_CHARS: usize = 8_000;
const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
const MAX_REDIRECTS: usize = 5;
/// Response headers worth showing (the rest is noise for checking a route).
const SHOWN_HEADERS: [&str; 6] = ["content-type", "content-length", "location", "cache-control", "set-cookie", "www-authenticate"];

/// `localhost` (and `*.localhost`), `127.0.0.0/8`, `::1`. Only http/https.
pub fn is_loopback(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        // `Url` already normalised IPv4 forms (`127.1` → `127.0.0.1`).
        Ok(ip) => ip.is_loopback(),
        Err(_) => {
            let d = host.trim_end_matches('.').to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
    }
}

/// Parse and check a URL argument. `Err` explains why it is not allowed.
pub fn local_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw.trim()).map_err(|e| anyhow!("invalid url `{raw}`: {e}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!("credentials in the url are not allowed"));
    }
    if !is_loopback(&url) {
        return Err(anyhow!(
            "http_check only reaches this machine (localhost, 127.0.0.1, ::1); `{}` is not local",
            url.host_str().unwrap_or("?")
        ));
    }
    Ok(url)
}

/// Methods allowed in read-only modes (they should not change the app's state).
pub fn is_safe_method(args: &Value) -> bool {
    let m = args.get("method").and_then(Value::as_str).unwrap_or("GET").to_ascii_uppercase();
    matches!(m.as_str(), "GET" | "HEAD" | "OPTIONS")
}

pub async fn http_check(args: &Value) -> Result<ToolOutput> {
    let url = local_url(args.get("url").and_then(Value::as_str).unwrap_or(""))?;
    let method = args.get("method").and_then(Value::as_str).unwrap_or("GET").to_ascii_uppercase();
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| anyhow!("invalid method `{method}`"))?;
    let timeout = Duration::from_millis(
        args.get("timeout_ms").and_then(Value::as_u64).unwrap_or(DEFAULT_TIMEOUT_MS).clamp(100, MAX_TIMEOUT_MS),
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(timeout)
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if is_loopback(attempt.url()) {
                attempt.follow()
            } else {
                let host = attempt.url().host_str().unwrap_or("?").to_string();
                attempt.error(format!("redirect to non-local host `{host}` blocked"))
            }
        }))
        .build()?;
    let mut req = client.request(method.clone(), url.clone());
    if let Some(h) = args.get("headers").and_then(Value::as_object) {
        for (k, v) in h {
            if let Some(v) = v.as_str() {
                req = req.header(k.as_str(), v);
            }
        }
    }
    if let Some(body) = args.get("body") {
        req = match body {
            Value::String(s) => req.body(s.clone()),
            Value::Null => req,
            other => req.header("content-type", "application/json").body(other.to_string()),
        };
    }
    let started = Instant::now();
    let mut resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            // Connection refused / timeout is a normal answer to "is it up?", not a tool failure.
            let why = if e.is_timeout() {
                "timed out".to_string()
            } else if e.is_connect() {
                "connection refused (is the server running? see proc_list / proc_logs)".to_string()
            } else if e.is_redirect() {
                format!("redirect stopped: {}", root_cause(&e))
            } else {
                root_cause(&e)
            };
            return Ok(ToolOutput {
                ok: false,
                output: format!("{method} {url}\nno response: {why}"),
                diff: None,
            });
        }
    };
    let status = resp.status();
    let final_url = resp.url().clone();
    let headers: Vec<String> = SHOWN_HEADERS
        .iter()
        .filter_map(|h| resp.headers().get(*h).map(|v| format!("{h}: {}", v.to_str().unwrap_or("?"))))
        .collect();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut bytes = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp.chunk().await? {
        let room = MAX_READ_BYTES - bytes.len();
        if chunk.len() > room {
            bytes.extend_from_slice(&chunk[..room]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let ms = started.elapsed().as_millis();
    let raw = args.get("raw").and_then(Value::as_bool).unwrap_or(false);
    let text = String::from_utf8_lossy(&bytes);
    let body = if method == Method::HEAD {
        String::new()
    } else if !raw && content_type.contains("html") {
        html_to_text(&text)
    } else if !raw && content_type.contains("json") {
        serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| serde_json::to_string_pretty(&v).ok())
            .unwrap_or_else(|| text.into_owned())
    } else {
        text.into_owned()
    };
    let (body, cut) = clip_chars(&body, MAX_BODY_CHARS);

    let mut out = format!("{method} {url}\n");
    if final_url != url {
        out.push_str(&format!("final url: {final_url}\n"));
    }
    out.push_str(&format!(
        "status: {} {}\ntime: {ms} ms, body: {} bytes{}\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        bytes.len(),
        if truncated { "+ (stopped reading)" } else { "" }
    ));
    for h in headers {
        out.push_str(&h);
        out.push('\n');
    }
    if !body.trim().is_empty() {
        out.push_str(if !raw && content_type.contains("html") { "--- page text ---\n" } else { "---\n" });
        out.push_str(body.trim_end());
        out.push('\n');
        if cut {
            out.push_str("…[body cut; use raw/grep-friendly routes or proc_logs for more]\n");
        }
    }
    Ok(ToolOutput {
        ok: status.is_success() || status.is_redirection(),
        output: out,
        diff: None,
    })
}

fn root_cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut cur: &dyn std::error::Error = e;
    while let Some(next) = cur.source() {
        cur = next;
    }
    cur.to_string()
}

fn clip_chars(s: &str, max: usize) -> (String, bool) {
    match s.char_indices().nth(max) {
        None => (s.to_string(), false),
        Some((i, _)) => (s[..i].to_string(), true),
    }
}

/// Visible text of an HTML page: title, then text with block elements on their own lines.
/// No scripts, styles or comments. Good enough to check "does the page say what it should".
pub fn html_to_text(html: &str) -> String {
    static RES: OnceLock<[Regex; 6]> = OnceLock::new();
    let [drop, title, block, tag, spaces, blanks] = RES.get_or_init(|| {
        [
            Regex::new(r"(?is)<!--.*?-->|<(script|style|noscript|template|svg)\b.*?</(script|style|noscript|template|svg)\s*>").unwrap(),
            Regex::new(r"(?is)<title[^>]*>(.*?)</title\s*>").unwrap(),
            Regex::new(r"(?i)<br\s*/?>|</?(p|div|li|ul|ol|tr|table|section|article|header|footer|main|nav|h[1-6]|pre|form|label|button|option|select|textarea|blockquote)\b[^>]*>").unwrap(),
            Regex::new(r"(?s)<[^>]+>").unwrap(),
            Regex::new(r"[ \t\u{a0}]+").unwrap(),
            Regex::new(r"\n\s*\n+").unwrap(),
        ]
    });
    let title_text = title.captures(html).map(|c| decode_entities(c[1].trim())).filter(|t| !t.is_empty());
    let s = drop.replace_all(html, " ");
    let s = title.replace_all(&s, " ");
    let s = block.replace_all(&s, "\n");
    let s = tag.replace_all(&s, " ");
    let s = decode_entities(&s);
    let s = spaces.replace_all(&s, " ");
    let lines: Vec<&str> = s.lines().map(str::trim).collect();
    let s = blanks.replace_all(&lines.join("\n"), "\n").trim().to_string();
    match title_text {
        Some(t) => format!("title: {t}\n{s}"),
        None => s,
    }
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn only_loopback_urls() {
        for ok in ["http://localhost:5173/", "https://127.0.0.1:8443/x", "http://[::1]:3000", "http://app.localhost/", "http://127.1.2.3/"] {
            assert!(local_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://example.com/",
            "http://localhost.evil.com/",
            "http://192.168.1.5:5173/",
            "http://0.0.0.0:3000/",
            "file:///C:/Windows/win.ini",
            "ftp://localhost/",
            "http://user:pw@localhost/",
            "not a url",
        ] {
            assert!(local_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn safe_methods() {
        assert!(is_safe_method(&json!({})));
        assert!(is_safe_method(&json!({"method": "head"})));
        assert!(!is_safe_method(&json!({"method": "POST"})));
        assert!(!is_safe_method(&json!({"method": "delete"})));
    }

    #[test]
    fn html_becomes_text() {
        let html = r#"<html><head><title>Cart &amp; Co</title><style>p{}</style><script>alert(1)</script></head>
            <body><!-- hidden --><h1>Your cart</h1><ul><li>Apple&nbsp;×2</li><li>Pear</li></ul>
            <button id="pay">Pay&nbsp;now</button></body></html>"#;
        assert_eq!(html_to_text(html), "title: Cart & Co\nYour cart\nApple ×2\nPear\nPay now");
    }

    /// One-shot HTTP server on 127.0.0.1 answering each connection with the next canned reply.
    async fn serve(replies: Vec<String>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            for reply in replies {
                let (mut s, _) = l.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf).await;
                let _ = s.write_all(reply.as_bytes()).await;
                let _ = s.shutdown().await;
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    fn reply(status: &str, headers: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
    }

    #[tokio::test]
    async fn gets_status_and_page_text() {
        let base = serve(vec![reply("200 OK", "content-type: text/html\r\n", "<title>Hi</title><p>Hello <b>there</b></p>")]).await;
        let out = http_check(&json!({"url": format!("{base}/")})).await.unwrap();
        assert!(out.ok);
        assert!(out.output.contains("status: 200 OK"), "{}", out.output);
        assert!(out.output.contains("title: Hi\nHello there"), "{}", out.output);
    }

    #[tokio::test]
    async fn json_is_pretty_and_500_is_not_ok() {
        let base = serve(vec![reply("500 Internal Server Error", "content-type: application/json\r\n", r#"{"error":"boom"}"#)]).await;
        let out = http_check(&json!({"url": format!("{base}/api")})).await.unwrap();
        assert!(!out.ok);
        assert!(out.output.contains("status: 500") && out.output.contains("\"error\": \"boom\""), "{}", out.output);
    }

    #[tokio::test]
    async fn redirect_off_loopback_is_stopped() {
        let base = serve(vec![reply("302 Found", "location: http://example.com/steal\r\n", "")]).await;
        let out = http_check(&json!({"url": format!("{base}/login")})).await.unwrap();
        assert!(!out.ok);
        assert!(out.output.contains("redirect to non-local host `example.com` blocked"), "{}", out.output);
    }

    #[tokio::test]
    async fn closed_port_is_an_answer_not_an_error() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let out = http_check(&json!({"url": format!("http://127.0.0.1:{port}/")})).await.unwrap();
        // The freed port can be handed to a server of a test running in parallel; then there is nothing to check.
        if out.output.contains("status:") {
            eprintln!("skip: port {port} was reused");
            return;
        }
        assert!(!out.ok);
        assert!(out.output.contains("no response"), "{}", out.output);
    }

    #[tokio::test]
    async fn non_local_url_is_refused_before_any_request() {
        assert!(http_check(&json!({"url": "https://example.com/"})).await.is_err());
    }
}
