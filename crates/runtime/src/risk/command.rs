//! Conservative shell command splitter for risk classification (PowerShell + POSIX subset).
//!
//! It never tries to fully understand a shell: it splits a command line into segments
//! (`|`, `;`, `&&`, `||`, `&`, newline, `(`, `)`, `{`, `}`), keeps quoted text together and
//! flags constructs it cannot see through (`$(…)`, backtick subshells, process substitution).
//! Anything flagged is classified at least `ask` by the caller.

/// One simple command inside a command line.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    /// Words with surrounding quotes removed. `tokens[0]` is the program (if any).
    pub tokens: Vec<String>,
    /// True when stdin of this segment is the stdout of the previous one (`a | b`).
    pub piped: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Parsed {
    pub segments: Vec<Segment>,
    /// `$(…)`, backtick subshell, `<(…)`/`>(…)`, or unbalanced quotes.
    pub dynamic: bool,
    /// Targets of `>`/`>>` (and `2>`), except null devices.
    pub redirects: Vec<String>,
}

pub fn parse(cmd: &str) -> Parsed {
    let mut p = Parsed::default();
    let mut cur: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut has_word = false;
    let mut piped_next = false;
    let mut pending_redirect = false;
    let chars: Vec<char> = cmd.chars().collect();
    let (mut single, mut double) = (false, false);
    let mut i = 0;

    fn end_word(word: &mut String, has_word: &mut bool, cur: &mut Vec<String>, redirect: &mut bool, p: &mut Parsed) {
        if *has_word {
            if *redirect {
                if !is_null_device(word) {
                    p.redirects.push(std::mem::take(word));
                } else {
                    word.clear();
                }
                *redirect = false;
            } else {
                cur.push(std::mem::take(word));
            }
            *has_word = false;
        }
    }
    fn end_segment(cur: &mut Vec<String>, piped: &mut bool, p: &mut Parsed) {
        if !cur.is_empty() {
            p.segments.push(Segment { tokens: std::mem::take(cur), piped: *piped });
        }
        *piped = false;
    }

    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if single {
            if c == '\'' {
                single = false;
            } else {
                word.push(c);
            }
            i += 1;
            continue;
        }
        if double {
            match c {
                '"' => double = false,
                '$' if next == Some('(') => {
                    p.dynamic = true;
                    word.push(c);
                }
                '`' => {
                    // PowerShell escapes inside double quotes (`n, `t, `", ``) are harmless;
                    // anything else may be a POSIX command substitution.
                    match next {
                        Some('n' | 't' | 'r' | '0' | '"' | '\'' | '`' | '$') => {
                            word.push(c);
                            word.push(next.unwrap_or_default());
                            i += 2;
                            continue;
                        }
                        _ => p.dynamic = true,
                    }
                    word.push(c);
                }
                _ => word.push(c),
            }
            i += 1;
            continue;
        }
        match c {
            '\'' => {
                single = true;
                has_word = true;
            }
            '"' => {
                double = true;
                has_word = true;
            }
            '`' => {
                p.dynamic = true;
                word.push(c);
                has_word = true;
            }
            '$' if next == Some('(') => {
                p.dynamic = true;
                word.push(c);
                has_word = true;
            }
            '<' | '>' if next == Some('(') => {
                p.dynamic = true;
                i += 1;
            }
            ' ' | '\t' | '\r' => end_word(&mut word, &mut has_word, &mut cur, &mut pending_redirect, &mut p),
            '\n' | ';' | '(' | ')' | '{' | '}' => {
                end_word(&mut word, &mut has_word, &mut cur, &mut pending_redirect, &mut p);
                end_segment(&mut cur, &mut piped_next, &mut p);
            }
            '|' => {
                end_word(&mut word, &mut has_word, &mut cur, &mut pending_redirect, &mut p);
                end_segment(&mut cur, &mut piped_next, &mut p);
                if next == Some('|') {
                    i += 1;
                } else {
                    piped_next = true;
                }
            }
            '&' => {
                // `2>&1` / `>&2` are stream merges, not separators.
                if word.ends_with('>') {
                    word.push(c);
                    has_word = true;
                } else {
                    end_word(&mut word, &mut has_word, &mut cur, &mut pending_redirect, &mut p);
                    end_segment(&mut cur, &mut piped_next, &mut p);
                    if next == Some('&') {
                        i += 1;
                    }
                }
            }
            '>' => {
                // `2>`, `>>`, `>` start a redirect; `2>&1` is handled when `&` arrives.
                let stream_prefix = word.chars().all(|ch| ch.is_ascii_digit() || ch == '*');
                if has_word && !stream_prefix {
                    end_word(&mut word, &mut has_word, &mut cur, &mut pending_redirect, &mut p);
                } else {
                    word.clear();
                    has_word = false;
                }
                if next == Some('>') {
                    i += 1;
                }
                if chars.get(i + 1) == Some(&'&') {
                    // `>&1`: merge, consume the stream number.
                    i += 2;
                    while chars.get(i + 1).is_some_and(|ch| ch.is_ascii_digit()) {
                        i += 1;
                    }
                } else {
                    pending_redirect = true;
                }
            }
            _ => {
                word.push(c);
                has_word = true;
            }
        }
        i += 1;
    }
    if single || double {
        p.dynamic = true;
    }
    end_word(&mut word, &mut has_word, &mut cur, &mut pending_redirect, &mut p);
    end_segment(&mut cur, &mut piped_next, &mut p);
    p
}

fn is_null_device(w: &str) -> bool {
    matches!(w.to_ascii_lowercase().as_str(), "$null" | "/dev/null" | "nul" | "null")
}

/// Canonical program name: basename, lowercase, no Windows extension.
pub fn program_name(tok: &str) -> String {
    let base = tok.rsplit(['/', '\\']).next().unwrap_or(tok).to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".com", ".ps1"] {
        if let Some(s) = base.strip_suffix(ext) {
            return s.to_string();
        }
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(p: &Parsed) -> Vec<Vec<&str>> {
        p.segments.iter().map(|s| s.tokens.iter().map(String::as_str).collect()).collect()
    }

    #[test]
    fn splits_pipes_and_separators() {
        let p = parse("curl -s https://x.sh | sh; echo ok && git status || true");
        assert_eq!(
            toks(&p),
            vec![vec!["curl", "-s", "https://x.sh"], vec!["sh"], vec!["echo", "ok"], vec!["git", "status"], vec!["true"]]
        );
        assert!(p.segments[1].piped);
        assert!(!p.segments[2].piped);
        assert!(!p.dynamic);
    }

    #[test]
    fn keeps_quotes_and_flags_dynamic() {
        let p = parse(r#"git commit -m "fix: a | b""#);
        assert_eq!(toks(&p), vec![vec!["git", "commit", "-m", "fix: a | b"]]);
        assert!(parse("echo $(whoami)").dynamic);
        assert!(parse("echo `whoami`").dynamic);
        assert!(!parse(r#"Write-Output "a`nb""#).dynamic);
        assert!(parse("echo 'unterminated").dynamic);
    }

    #[test]
    fn parens_and_braces_expose_inner_commands() {
        let p = parse("iex (iwr https://x/a.ps1)");
        assert_eq!(toks(&p), vec![vec!["iex"], vec!["iwr", "https://x/a.ps1"]]);
        let p = parse("Get-ChildItem | ForEach-Object { Remove-Item $_ -Recurse }");
        assert_eq!(toks(&p)[2], vec!["Remove-Item", "$_", "-Recurse"]);
    }

    #[test]
    fn redirects_are_collected_and_null_ignored() {
        let p = parse("npm test > out.log 2>&1");
        assert_eq!(toks(&p), vec![vec!["npm", "test"]]);
        assert_eq!(p.redirects, vec!["out.log"]);
        let p = parse("cargo build 2> $null; echo hi >> C:\\x\\y.txt");
        assert_eq!(p.redirects, vec!["C:\\x\\y.txt"]);
    }

    #[test]
    fn program_names_are_canonical() {
        assert_eq!(program_name(r".\scripts\cargo-msvc.bat"), "cargo-msvc");
        assert_eq!(program_name("C:/Windows/System32/CMD.EXE"), "cmd");
        assert_eq!(program_name("Remove-Item"), "remove-item");
    }
}
