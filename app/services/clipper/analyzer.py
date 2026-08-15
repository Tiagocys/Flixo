import json
import re
from uuid import uuid4

from loguru import logger

from app.services import llm
from app.services.clipper.models import ClipCandidate, TranscriptSegment
from app.services.clipper.prompts import build_clip_analysis_prompt
from app.services.clipper.scorer import dedupe_and_rank
from app.services.clipper.segmenter import transcript_blocks

_MAX_END_EXTENSION_SECONDS = 18.0
_MAX_NATURAL_END_OVERRUN_SECONDS = 12.0
_MAX_DIALOGUE_GAP_SECONDS = 1.1
_MIN_TOPIC_SHIFT_CLIP_SECONDS = 16.0
_TERMINAL_PUNCTUATION = (".", "!", "?", "…")
_NEW_TOPIC_PREFIXES = (
    "aqui",
    "agora",
    "beleza",
    "bom",
    "enfim",
    "inclusive",
    "olha",
    "outra coisa",
    "pronto",
    "próximo",
    "proximo",
    "se liga",
    "vamos",
)


def analyze_transcript(
    segments: list[TranscriptSegment],
    max_candidates: int = 8,
    min_duration: int = 20,
    max_duration: int = 90,
) -> list[ClipCandidate]:
    video_duration = max((segment.end for segment in segments), default=0)
    effective_min = min(min_duration, max(6, int(video_duration // 2) or min_duration))
    candidates: list[ClipCandidate] = []

    for block in transcript_blocks(segments):
        prompt = build_clip_analysis_prompt(block, max_candidates, effective_min, max_duration)
        response = llm._generate_response(prompt)  # Existing project adapter; sanitized on failure.
        if response.startswith("Error:"):
            logger.warning(f"clipper llm analysis failed, using fallback: {response}")
            continue
        candidates.extend(_parse_candidates(response, video_duration, effective_min, max_duration))

    if not candidates:
        candidates = _fallback_candidates(segments, max_candidates, effective_min, max_duration)

    candidates = _fit_candidates_to_transcript(candidates, segments, effective_min, max_duration)
    return dedupe_and_rank(candidates, max_candidates)


def _parse_candidates(
    response: str,
    video_duration: float,
    min_duration: int,
    max_duration: int,
) -> list[ClipCandidate]:
    payload = _loads_json(response)
    raw_clips = payload.get("clips", payload if isinstance(payload, list) else [])
    if not isinstance(raw_clips, list):
        return []

    candidates: list[ClipCandidate] = []
    for raw in raw_clips:
        if not isinstance(raw, dict):
            continue
        start = _float(raw.get("start", raw.get("start_time")), 0)
        end = _float(raw.get("end", raw.get("end_time")), 0)
        start = max(0.0, min(start, max(0.0, video_duration - 1)))
        end = max(start + 1, min(end, video_duration))
        duration = end - start
        if duration < min_duration * 0.65 or duration > max_duration * 1.25:
            continue
        scores = _scores(raw.get("scores"))
        candidates.append(
            ClipCandidate(
                id=f"clip-{uuid4().hex[:8]}",
                start=round(start, 2),
                end=round(end, 2),
                duration=round(duration, 2),
                title=str(raw.get("title") or "Corte sugerido").strip()[:90],
                hook=str(raw.get("hook") or "").strip()[:200],
                summary=str(raw.get("summary") or "").strip()[:400],
                reason=str(raw.get("reason") or "").strip()[:500],
                scores=scores,
            )
        )
    return candidates


def _loads_json(text: str):
    clean = text.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```[a-zA-Z0-9]*\s*", "", clean)
        clean = re.sub(r"\s*```$", "", clean).strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", clean, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(1))


def _fit_candidates_to_transcript(
    candidates: list[ClipCandidate],
    segments: list[TranscriptSegment],
    min_duration: int,
    max_duration: int,
) -> list[ClipCandidate]:
    if not segments:
        return candidates

    fitted: list[ClipCandidate] = []
    video_end = segments[-1].end
    for candidate in candidates:
        start = _snap_start(candidate.start, segments)
        end = _extend_end(candidate.end, start, segments, max_duration, video_end)
        end = _trim_trailing_topic_shift(start, end, segments, min_duration)
        fitted.append(
            ClipCandidate(
                id=candidate.id,
                start=round(start, 2),
                end=round(end, 2),
                duration=round(end - start, 2),
                title=candidate.title,
                hook=candidate.hook,
                summary=candidate.summary,
                reason=candidate.reason,
                scores=candidate.scores,
            )
        )
    return fitted


def _snap_start(start: float, segments: list[TranscriptSegment]) -> float:
    nearest = min(segments, key=lambda segment: abs(segment.start - start))
    if abs(nearest.start - start) <= 1.5:
        return nearest.start
    return start


def _extend_end(
    end: float,
    start: float,
    segments: list[TranscriptSegment],
    max_duration: int,
    video_end: float,
) -> float:
    current_index = _segment_index_at(end, segments)
    if current_index is None:
        return min(end + 1.0, video_end, start + max_duration)

    extended_end = max(end, segments[current_index].end)
    deadline = min(
        video_end,
        start + max_duration + _MAX_NATURAL_END_OVERRUN_SECONDS,
        end + _MAX_END_EXTENSION_SECONDS,
    )
    current_text = segments[current_index].text.strip()
    should_extend = not current_text.endswith(_TERMINAL_PUNCTUATION)

    for next_segment in segments[current_index + 1 :]:
        gap = next_segment.start - extended_end
        if gap > _MAX_DIALOGUE_GAP_SECONDS or next_segment.end > deadline:
            break
        if not should_extend:
            break
        if extended_end - end >= 4.0 and _looks_like_new_topic(next_segment.text):
            break
        extended_end = next_segment.end
        text = next_segment.text.strip()
        if text.endswith(_TERMINAL_PUNCTUATION) and extended_end - end >= 1.5:
            break

    return max(end, extended_end)


def _trim_trailing_topic_shift(
    start: float,
    end: float,
    segments: list[TranscriptSegment],
    min_duration: int,
) -> float:
    selected = [segment for segment in segments if segment.end > start + 0.1 and segment.start < end - 0.1]
    if len(selected) < 2:
        return end

    min_end = start + max(_MIN_TOPIC_SHIFT_CLIP_SECONDS, min_duration * 0.65)
    for index in range(1, len(selected)):
        previous = selected[index - 1]
        current = selected[index]
        if current.start < min_end:
            continue
        if not _looks_like_new_topic(current.text):
            continue
        previous_text = previous.text.strip()
        has_clean_previous_end = previous_text.endswith(_TERMINAL_PUNCTUATION)
        has_breath = current.start - previous.end >= 0.35
        near_tail = end - current.start <= 9.0
        if has_clean_previous_end or has_breath or near_tail:
            return max(start + 1.0, previous.end)
    return end


def _looks_like_new_topic(text: str) -> bool:
    normalized = _normalize_topic_text(text)
    return any(normalized.startswith(prefix) for prefix in _NEW_TOPIC_PREFIXES)


def _normalize_topic_text(text: str) -> str:
    normalized = text.strip().lower()
    normalized = normalized.replace("á", "a").replace("à", "a").replace("ã", "a")
    normalized = normalized.replace("â", "a").replace("é", "e").replace("ê", "e")
    normalized = normalized.replace("í", "i").replace("ó", "o").replace("ô", "o")
    normalized = normalized.replace("õ", "o").replace("ú", "u").replace("ç", "c")
    normalized = re.sub(r"^[\"'“”‘’()\\[\\]\\s]+", "", normalized)
    return normalized


def _segment_index_at(time_value: float, segments: list[TranscriptSegment]) -> int | None:
    best_index = None
    best_distance = float("inf")
    for index, segment in enumerate(segments):
        if segment.start - 0.25 <= time_value <= segment.end + 0.25:
            return index
        distance = abs(segment.end - time_value)
        if distance < best_distance:
            best_distance = distance
            best_index = index
    return best_index if best_distance <= 1.5 else None


def _fallback_candidates(
    segments: list[TranscriptSegment],
    max_candidates: int,
    min_duration: int,
    max_duration: int,
) -> list[ClipCandidate]:
    windows: list[ClipCandidate] = []
    stride = max(1, min_duration // 2)
    start_points = [segment.start for segment in segments[:: max(1, len(segments) // 18)]]
    if not start_points:
        start_points = [0.0]

    for index, start in enumerate(start_points):
        end = min(start + max_duration, segments[-1].end)
        selected = [segment for segment in segments if segment.start >= start and segment.end <= end]
        if not selected:
            continue
        real_start = selected[0].start
        real_end = selected[-1].end
        duration = real_end - real_start
        if duration < min_duration * 0.65:
            continue
        text = " ".join(segment.text for segment in selected)
        score = max(55, min(82, 55 + len(text) // 45))
        windows.append(
            ClipCandidate(
                id=f"clip-fallback-{index + 1}",
                start=round(real_start, 2),
                end=round(real_end, 2),
                duration=round(duration, 2),
                title=f"Trecho relevante {index + 1}",
                hook=selected[0].text[:180],
                summary=text[:320],
                reason="Fallback heuristico: trecho com densidade de fala e duracao adequada.",
                scores={
                    "hook": score,
                    "retention": score,
                    "context": score,
                    "payoff": score - 5,
                    "emotion": score - 10,
                    "overall": score,
                },
            )
        )
        if len(windows) >= max_candidates * 2:
            break
        start += stride
    return windows[:max_candidates]


def _float(value, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _scores(value) -> dict[str, int]:
    raw = value if isinstance(value, dict) else {}
    overall = _score(raw.get("overall"), 70)
    return {
        "hook": _score(raw.get("hook"), overall),
        "retention": _score(raw.get("retention"), overall),
        "context": _score(raw.get("context"), overall),
        "payoff": _score(raw.get("payoff"), overall),
        "emotion": _score(raw.get("emotion"), overall),
        "overall": overall,
    }


def _score(value, fallback: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        parsed = fallback
    return max(0, min(100, parsed))
