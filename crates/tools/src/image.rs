//! Image files in the workspace: read as a `data:` URL for the Studio preview (`fs.read_image`)
//! and for the agent's `view_image` tool. Same jail as every other tool (`Workspace::resolve`).

use crate::{obj, ToolSpec, Workspace};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::json;
use std::path::Path;

/// Largest image read from the workspace (bytes). Providers cap a single image near 5 MB.
pub const MAX_IMAGE_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ImageFile {
    /// Workspace-relative path with `/`.
    pub path: String,
    pub mime: &'static str,
    pub bytes: u64,
    /// `data:<mime>;base64,...`
    pub data_url: String,
}

/// MIME by extension. SVG is listed for previews; models cannot take it as an image.
pub fn image_mime(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// True for formats a vision model accepts (not SVG).
pub fn model_readable(mime: &str) -> bool {
    matches!(mime, "image/png" | "image/jpeg" | "image/gif" | "image/webp")
}

/// Read an image file inside the workspace. Errors: outside the jail, not an image
/// extension, missing, or larger than `MAX_IMAGE_FILE_BYTES`.
pub fn read_image(ws: &Workspace, rel: &str) -> Result<ImageFile> {
    let mime = image_mime(rel).ok_or_else(|| anyhow!("not an image file (png, jpg, gif, webp, svg): {rel}"))?;
    let path = ws.resolve(rel)?;
    let meta = std::fs::metadata(&path).with_context(|| ws.rel(&path))?;
    if !meta.is_file() {
        bail!("not a file: {}", ws.rel(&path));
    }
    if meta.len() > MAX_IMAGE_FILE_BYTES {
        bail!(
            "image is {} KB, larger than the {} MB limit",
            meta.len() / 1024,
            MAX_IMAGE_FILE_BYTES / 1024 / 1024
        );
    }
    let raw = std::fs::read(&path).with_context(|| ws.rel(&path))?;
    Ok(ImageFile {
        path: ws.rel(&path),
        mime,
        bytes: raw.len() as u64,
        data_url: format!("data:{mime};base64,{}", base64(&raw)),
    })
}

pub fn spec_view_image() -> ToolSpec {
    ToolSpec {
        name: "view_image".into(),
        description: "Look at an image file in the workspace (png, jpg, gif, webp; max 5 MB). \
            The image is attached to the conversation so you can see it. Use it to check images \
            you created or ones the user refers to. SVG is text: use read."
            .into(),
        parameters: obj(json!({ "path": {"type": "string"} }), &["path"]),
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn read_image_reads_inside_and_refuses_outside() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        std::fs::write(dir.path().join("img/a.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let ws = Workspace::new(dir.path()).unwrap();

        let img = read_image(&ws, "img/a.png").unwrap();
        assert_eq!(img.path, "img/a.png");
        assert_eq!(img.mime, "image/png");
        assert_eq!(img.data_url, "data:image/png;base64,iVBORw==");

        assert!(read_image(&ws, "notes.txt").is_err());
        assert!(read_image(&ws, "missing.png").is_err());
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("b.png"), [1, 2, 3]).unwrap();
        assert!(read_image(&ws, outside.path().join("b.png").to_str().unwrap()).is_err());
    }

    #[test]
    fn mime_and_model_readable() {
        assert_eq!(image_mime("A.JPG"), Some("image/jpeg"));
        assert_eq!(image_mime("x.svg"), Some("image/svg+xml"));
        assert_eq!(image_mime("x.bmp"), None);
        assert!(!model_readable("image/svg+xml"));
        assert!(model_readable("image/webp"));
    }
}
