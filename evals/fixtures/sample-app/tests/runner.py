"""Minimal runner: python -m tests.runner [filter]. Exit 0 if all pass."""

from __future__ import annotations

import sys
import traceback
from typing import Callable

from src.calc import add, clamp, div, factorial, is_even, mul, sub
from src.stats import mean, median, moving_average
from src.user import User, UserStore
from src.util import chunks, join_workspace, slugify


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_add() -> None:
    _assert(add(2, 3) == 5, "add")


def test_mul() -> None:
    _assert(mul(3, 4) == 12, "mul")


def test_factorial() -> None:
    _assert(factorial(0) == 1, "factorial 0")
    _assert(factorial(5) == 120, "factorial 5")


def test_clamp() -> None:
    _assert(clamp(5, 0, 10) == 5, "clamp mid")
    _assert(clamp(-1, 0, 10) == 0, "clamp lo")


def test_div() -> None:
    _assert(div(8, 2) == 4, "div")


def test_even() -> None:
    _assert(is_even(2) is True, "even")
    _assert(is_even(3) is False, "odd")


def test_sub() -> None:
    _assert(sub(9, 4) == 5, "sub")


def test_user_get_missing() -> None:
    store = UserStore()
    _assert(store.get(1) is None, "missing user is None")


def test_find_email_case() -> None:
    store = UserStore()
    store.add(User(1, "A", "Dev@Corp.com"))
    found = store.find_by_email("dev@corp.com")
    _assert(found is not None and found.id == 1, "email case")


def test_mean_empty() -> None:
    _assert(mean([]) == 0.0, "mean empty")


def test_median() -> None:
    _assert(median([1, 3, 2]) == 2, "median odd")
    _assert(median([1, 2, 3, 4]) == 2.5, "median even")


def test_moving_average() -> None:
    got = moving_average([1, 2, 3, 4], 2)
    _assert(got == [1.0, 1.5, 2.5, 3.5], f"ma {got}")


def test_join_workspace() -> None:
    path = join_workspace("C:\\work", "src", "a.py")
    _assert("\\" in path or path.endswith("a.py"), "join")
    _assert("work" in path.replace("/", "\\"), "workspace in path")


def test_chunks() -> None:
    _assert(chunks(["a", "b", "c"], 2) == [["a", "b"], ["c"]], "chunks")


def test_slugify() -> None:
    _assert(slugify("Hello World") == "hello-world", "slug")


TESTS: dict[str, Callable[[], None]] = {
    name: fn
    for name, fn in globals().items()
    if name.startswith("test_") and callable(fn)
}


def main() -> int:
    needle = sys.argv[1] if len(sys.argv) > 1 else ""
    failed = 0
    ran = 0
    for name, fn in sorted(TESTS.items()):
        if needle and needle not in name:
            continue
        ran += 1
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}: {exc}")
            traceback.print_exc()
    print(f"{ran - failed}/{ran} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
