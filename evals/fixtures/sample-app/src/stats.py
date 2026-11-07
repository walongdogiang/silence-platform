from typing import Sequence


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)  # BUG: ZeroDivisionError on empty


def median(values: Sequence[float]) -> float:
    if not values:
        raise ValueError("empty")
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2


def moving_average(values: Sequence[float], window: int) -> list[float]:
    if window <= 0:
        raise ValueError("window")
    out: list[float] = []
    for i in range(len(values)):
        start = max(0, i - window)  # BUG: should be i - window + 1
        chunk = values[start : i + 1]
        out.append(sum(chunk) / len(chunk))
    return out
