"""Checks for the web-app fixture: `python tests/check.py <name>` exits 0 when the check passes."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def luminance(color: str) -> float | None:
    c = color.strip().lower()
    named = {"white": "#ffffff", "black": "#000000", "transparent": None}
    if c in named:
        if named[c] is None:
            return 1.0
        c = named[c]
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", c)
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def count_visible() -> bool:
    """The item count (#count) must be readable on the white page."""
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    for selector, body in re.findall(r"([^{}]+)\{([^}]*)\}", css):
        if "#count" not in selector:
            continue
        decls = dict(
            (k.strip().lower(), v.strip().lower())
            for k, _, v in (d.partition(":") for d in body.split(";"))
            if k.strip()
        )
        if decls.get("display") == "none" or decls.get("visibility") == "hidden" or decls.get("opacity") in ("0", "0.0"):
            return False
        lum = luminance(decls.get("color", "#000"))
        if lum is not None and lum > 0.8:
            return False
    return True


CHECKS = {"count_visible": count_visible}

if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    ok = CHECKS[name]() if name in CHECKS else False
    print(f"{name}: {'ok' if ok else 'FAIL'}")
    sys.exit(0 if ok else 1)
