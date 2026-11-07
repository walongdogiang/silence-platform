import os
from typing import Iterable


def join_workspace(*parts: str) -> str:
    # BUG: uses os.path.join incorrectly when first part is absolute on Windows
    return "/".join(parts)


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def chunks(items: Iterable[str], size: int) -> list[list[str]]:
    buf: list[str] = []
    out: list[list[str]] = []
    for item in items:
        buf.append(item)
        if len(buf) == size:
            out.append(buf)
            buf = []
    if buf:
        out.append(buf)
    return out


def slugify(text: str) -> str:
    return text.strip().lower().replace(" ", "-")
