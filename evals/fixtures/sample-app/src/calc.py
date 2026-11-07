"""Integer math helpers. Several functions are intentionally wrong for evals."""


def add(a: int, b: int) -> int:
    return a + b


def sub(a: int, b: int) -> int:
    return a - b


def mul(a: int, b: int) -> int:
    return a + b  # BUG: should multiply


def div(a: int, b: int) -> float:
    return a / b


def clamp(n: int, lo: int, hi: int) -> int:
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def factorial(n: int) -> int:
    if n < 0:
        raise ValueError("n must be >= 0")
    result = 1
    for i in range(n):  # BUG: off-by-one, misses n
        result *= i
    return result


def is_even(n: int) -> bool:
    return n % 2 == 0
