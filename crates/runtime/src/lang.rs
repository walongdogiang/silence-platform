//! Reply language, decided by the Engine instead of left to the model.
//!
//! "Reply in the language of the user's latest message" breaks on short messages ("ok",
//! "tiếp"), on a pasted English log with one Vietnamese line, and on small models. The Engine
//! looks at each prompt and keeps the last confident answer for the session: a message that says
//! nothing clear keeps the previous language, and the UI language fills in before any message
//! has. The result goes into the turn context (`agent/env.rs`) as `Reply language: …`.
//!
//! Only Vietnamese and English are named; anything else is left to the model (`None`).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplyLang {
    Vi,
    En,
}

impl ReplyLang {
    /// UI language code from Studio (`vi` | `en`); anything else is unknown.
    pub fn from_code(code: &str) -> Option<Self> {
        match code.trim().to_ascii_lowercase().as_str() {
            "vi" => Some(Self::Vi),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Vi => "Vietnamese",
            Self::En => "English",
        }
    }
}

/// Language for the next reply: this message if it is clear, else the session's last one, else
/// the UI language.
pub fn decide(text: &str, previous: Option<ReplyLang>, ui: Option<ReplyLang>) -> Option<ReplyLang> {
    detect(text).or(previous).or(ui)
}

/// The language a message is written in, when the prose says so clearly. Code (fenced or
/// inline), URLs and `<ui_context>` are ignored. `None` = too short or unclear (a bare "ok",
/// a command, an identifier, a pasted log, Vietnamese typed without diacritics).
pub fn detect(text: &str) -> Option<ReplyLang> {
    let prose = prose_of(text);
    let words: Vec<&str> = prose
        .split(|c: char| !c.is_alphabetic() && c != '\'')
        .map(|w| w.trim_matches('\''))
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        return None;
    }
    let marked: Vec<&&str> = words.iter().filter(|w| w.chars().any(is_vi_letter)).collect();
    // Vietnamese prose marks most syllables. A lowercase marked word is Vietnamese prose even
    // next to a long English paste ("dịch đoạn này: …", "lỗi gì đây? <log>"); capitalized ones
    // alone may just be a name ("ask Nguyễn to review") and leave the call to the English check.
    let lowercase = marked.iter().any(|w| w.chars().next().is_some_and(char::is_lowercase));
    if !marked.is_empty() && (marked.len() * 5 >= words.len() || lowercase) {
        return Some(ReplyLang::Vi);
    }
    if words.len() < 3 {
        return None;
    }
    // English prose is full of function words; a pasted log or a list of identifiers is not.
    let en = words
        .iter()
        .filter(|w| EN_WORDS.contains(&w.to_ascii_lowercase().as_str()))
        .count();
    (en > 0 && en * 8 >= words.len()).then_some(ReplyLang::En)
}

/// Common English function words that are not also unaccented Vietnamese syllables
/// ("to", "an", "me", "do", "can", "a" are left out on purpose).
const EN_WORDS: &[&str] = &[
    "the", "is", "are", "was", "were", "be", "been", "of", "and", "with", "this", "that", "these",
    "what", "why", "how", "when", "where", "which", "who", "please", "should", "would", "could",
    "does", "did", "not", "it", "it's", "you", "your", "my", "we", "our", "for", "from", "into",
    "there", "here", "have", "has", "will", "just", "about", "some", "any", "all", "if", "then",
    "than", "but", "so", "at", "by", "or", "i", "i'm", "don't", "can't", "doesn't", "isn't",
];

/// Letters only Vietnamese spelling uses together: đ, the vowels with a hat, breve or horn, and
/// any vowel carrying a tone mark. Expects NFC text (prompts are normalized on arrival).
fn is_vi_letter(c: char) -> bool {
    matches!(c, 'đ' | 'Đ')
        || ('\u{1EA0}'..='\u{1EF9}').contains(&c)
        || "àáâãèéêìíòóôõùúýăĩũơưÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĨŨƠƯ".contains(c)
}

/// The user's own words: drop `<ui_context>` (logs the UI attached), fenced code blocks, inline
/// code and URLs.
fn prose_of(text: &str) -> String {
    let text = text.split("<ui_context>").next().unwrap_or(text);
    let mut out = String::with_capacity(text.len());
    let mut in_fence = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut in_code = false;
        for part in line.split('`') {
            if !in_code {
                for word in part.split_whitespace() {
                    if !word.contains("://") {
                        out.push_str(word);
                        out.push(' ');
                    }
                }
            }
            in_code = !in_code;
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use ReplyLang::{En, Vi};

    #[test]
    fn vietnamese_prose() {
        assert_eq!(detect("Làm mục 1–3 trước"), Some(Vi));
        assert_eq!(detect("tiếp"), Some(Vi));
        assert_eq!(detect("fix lỗi này giúp tôi"), Some(Vi));
        assert_eq!(detect("Sửa mul() trong src/calc.py cho đúng giúp tôi."), Some(Vi));
    }

    #[test]
    fn english_prose() {
        assert_eq!(detect("Why does the login test fail?"), Some(En));
        assert_eq!(detect("Please add a test for the parser"), Some(En));
    }

    #[test]
    fn unclear_messages_say_nothing() {
        assert_eq!(detect("ok"), None);
        assert_eq!(detect("npm run test"), None);
        assert_eq!(detect("```\nfn main() {}\n```"), None);
        assert_eq!(detect("https://example.com/the/docs/for/this"), None);
        // Vietnamese typed without diacritics is not mistaken for English.
        assert_eq!(detect("lam muc 1 den 3 truoc di"), None);
    }

    #[test]
    fn a_pasted_log_does_not_flip_the_language() {
        let log = "Traceback (most recent call last):\n  File \"src/stats.py\", line 4, in mean\n    return sum(xs) / len(xs)\nZeroDivisionError: division by zero";
        assert_eq!(detect(log), None);
        assert_eq!(detect(&format!("lỗi gì đây?\n{log}")), Some(Vi));
        assert_eq!(detect(&format!("lỗi gì đây?\n```\n{log}\n```")), Some(Vi));
    }

    #[test]
    fn a_name_in_english_prose_stays_english() {
        assert_eq!(detect("Please ask Nguyễn to review the pull request when it is ready"), Some(En));
        assert_eq!(detect("Nguyễn Văn wrote this module, why is the cache never used?"), Some(En));
    }

    #[test]
    fn a_vietnamese_request_around_english_text_stays_vietnamese() {
        let para = "The quick brown fox jumps over the lazy dog, and this is what the documentation says about it.";
        assert_eq!(detect(&format!("dịch đoạn này: {para}")), Some(Vi));
    }

    #[test]
    fn ui_context_and_inline_code_are_ignored() {
        assert_eq!(detect("tiếp đi\n\n<ui_context>\nerror: the build failed with this and that\n</ui_context>"), Some(Vi));
        assert_eq!(detect("chạy `the test is failing and this is why` xem"), Some(Vi));
    }

    #[test]
    fn decide_falls_back_to_previous_then_ui() {
        assert_eq!(decide("ok", Some(En), Some(Vi)), Some(En));
        assert_eq!(decide("ok", None, Some(Vi)), Some(Vi));
        assert_eq!(decide("ok", None, None), None);
        assert_eq!(decide("tiếp tục", Some(En), Some(En)), Some(Vi));
    }

    #[test]
    fn ui_codes() {
        assert_eq!(ReplyLang::from_code("vi"), Some(Vi));
        assert_eq!(ReplyLang::from_code("EN"), Some(En));
        assert_eq!(ReplyLang::from_code("ja"), None);
    }
}
