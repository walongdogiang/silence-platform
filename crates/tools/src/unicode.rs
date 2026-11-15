//! Unicode normalization between what the model writes and what files hold.
//!
//! Vietnamese (and other Latin scripts with diacritics) can be stored precomposed (NFC: "ế" is
//! one code point) or decomposed (NFD: "e" + U+0302 + U+0301). Both render the same. Models
//! write NFC; text pasted from macOS, some input methods and older files is NFD. Then `grep`
//! finds nothing and `edit` says "old_string not found" for text that looks identical.
//!
//! Matching here ignores that difference. Writes keep the form the file already uses at that
//! spot, so an edit never rewrites the rest of a file into another form (no noisy diff).

use std::ops::Range;
use unicode_normalization::char::canonical_combining_class;
use unicode_normalization::{is_nfc_quick, IsNormalized, UnicodeNormalization};

/// `s` in NFC (unchanged and cheap when it already is).
pub fn nfc(s: &str) -> String {
    if is_nfc(s) {
        s.to_string()
    } else {
        s.nfc().collect()
    }
}

/// True when `s` is certainly NFC. A "maybe" from the quick check counts as no: callers then
/// normalize, which is always correct.
pub fn is_nfc(s: &str) -> bool {
    s.is_ascii() || is_nfc_quick(s.chars()) == IsNormalized::Yes
}

/// `s` in the form `sample` uses: as is when `sample` is NFC, decomposed (NFD) otherwise.
pub fn like(sample: &str, s: &str) -> String {
    if is_nfc(sample) {
        s.to_string()
    } else {
        s.nfd().collect()
    }
}

/// Byte ranges of `text` where `needle` occurs when both are compared in NFC, left to right,
/// non-overlapping. Meant as the fallback after an exact search found nothing.
pub fn find_nfc(text: &str, needle: &str) -> Vec<Range<usize>> {
    if needle.is_empty() || (text.is_ascii() && needle.is_ascii()) {
        return Vec::new();
    }
    let view = NfcView::new(text);
    let needle = nfc(needle);
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(k) = view.norm[from..].find(&needle) {
        let start = from + k;
        let end = start + needle.len();
        match (view.original(start), view.original(end)) {
            (Some(a), Some(b)) => {
                out.push(a..b);
                from = end;
            }
            // Starts or ends inside a cluster (a base letter without its marks): not a match.
            _ => from = start + view.norm[start..].chars().next().map_or(1, char::len_utf8),
        }
    }
    out
}

/// `text` in NFC with a map back to the original bytes at every cluster boundary (a starter
/// and the combining marks after it). Composition never crosses a cluster, so a match that
/// starts and ends on boundaries maps to an exact original range.
struct NfcView {
    norm: String,
    /// (offset in `norm`, offset in the original), ascending; ends with both lengths.
    bounds: Vec<(usize, usize)>,
}

impl NfcView {
    fn new(text: &str) -> Self {
        let mut norm = String::with_capacity(text.len());
        let mut bounds = Vec::new();
        let mut chars = text.char_indices().peekable();
        while let Some((start, c)) = chars.next() {
            let mut end = start + c.len_utf8();
            while let Some(&(j, d)) = chars.peek() {
                if canonical_combining_class(d) == 0 {
                    break;
                }
                end = j + d.len_utf8();
                chars.next();
            }
            bounds.push((norm.len(), start));
            let cluster = &text[start..end];
            if cluster.is_ascii() {
                norm.push_str(cluster);
            } else {
                norm.extend(cluster.nfc());
            }
        }
        bounds.push((norm.len(), text.len()));
        Self { norm, bounds }
    }

    fn original(&self, at: usize) -> Option<usize> {
        self.bounds
            .binary_search_by_key(&at, |b| b.0)
            .ok()
            .map(|k| self.bounds[k].1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "Tiếng Việt" with every accented letter decomposed.
    fn nfd(s: &str) -> String {
        s.nfd().collect()
    }

    #[test]
    fn nfc_composes_and_keeps_nfc_as_is() {
        let d = nfd("Tiếng Việt");
        assert_ne!(d, "Tiếng Việt");
        assert_eq!(nfc(&d), "Tiếng Việt");
        assert_eq!(nfc("Tiếng Việt"), "Tiếng Việt");
        assert!(is_nfc("plain ascii"));
        assert!(!is_nfc(&d));
    }

    #[test]
    fn finds_nfc_needle_in_nfd_text_with_exact_original_range() {
        let text = format!("// {}\nfn main() {{}}\n", nfd("Xin chào thế giới"));
        let found = find_nfc(&text, "chào thế");
        assert_eq!(found.len(), 1);
        assert_eq!(text[found[0].clone()], nfd("chào thế"));
    }

    #[test]
    fn finds_nfd_needle_in_nfc_text() {
        let text = "tiêu đề: Đổi giá trị";
        let found = find_nfc(text, &nfd("Đổi giá"));
        assert_eq!(found.len(), 1);
        assert_eq!(&text[found[0].clone()], "Đổi giá");
    }

    #[test]
    fn a_bare_base_letter_does_not_match_inside_a_cluster() {
        // "e" alone must not match the "e" of a decomposed "ế".
        let text = nfd("ế");
        assert!(find_nfc(&text, "e\u{0302}x").is_empty());
        assert!(find_nfc(&format!("{text}!"), "e!").is_empty());
    }

    #[test]
    fn several_matches_left_to_right() {
        let text = nfd("lỗi, lỗi và lỗi");
        assert_eq!(find_nfc(&text, "lỗi").len(), 3);
    }

    #[test]
    fn like_follows_the_sample_form() {
        assert_eq!(like("Việt", "thế"), "thế");
        assert_eq!(like(&nfd("Việt"), "thế"), nfd("thế"));
    }

    #[test]
    fn ascii_only_has_no_fallback() {
        assert!(find_nfc("hello", "world").is_empty());
    }
}
