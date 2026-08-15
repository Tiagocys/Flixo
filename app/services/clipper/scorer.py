from app.services.clipper.models import ClipCandidate


def dedupe_and_rank(candidates: list[ClipCandidate], limit: int) -> list[ClipCandidate]:
    ranked = sorted(
        candidates,
        key=lambda item: item.scores.get("overall", 0),
        reverse=True,
    )
    selected: list[ClipCandidate] = []
    for candidate in ranked:
        if any(_overlap_ratio(candidate, other) > 0.42 for other in selected):
            continue
        selected.append(candidate)
        if len(selected) >= limit:
            break
    return selected


def _overlap_ratio(a: ClipCandidate, b: ClipCandidate) -> float:
    overlap = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    if overlap <= 0:
        return 0.0
    return overlap / max(1.0, min(a.duration, b.duration))
