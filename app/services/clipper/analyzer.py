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
    source_context: dict | None = None,
) -> list[ClipCandidate]:
    video_duration = max((segment.end for segment in segments), default=0)
    effective_min = min(min_duration, max(6, int(video_duration // 2) or min_duration))
    candidates: list[ClipCandidate] = []

    for block in transcript_blocks(segments):
        prompt = build_clip_analysis_prompt(block, max_candidates, effective_min, max_duration, source_context)
        response = llm._generate_response(prompt)  # Existing project adapter; sanitized on failure.
        if response.startswith("Error:"):
            logger.warning(f"clipper llm analysis failed, using fallback: {response}")
            continue
        candidates.extend(_parse_candidates(response, video_duration, effective_min, max_duration, source_context))

    if not candidates:
        candidates = _fallback_candidates(segments, max_candidates, effective_min, max_duration, source_context)

    candidates = _fit_candidates_to_transcript(candidates, segments, effective_min, max_duration)
    return dedupe_and_rank(candidates, max_candidates)


def _parse_candidates(
    response: str,
    video_duration: float,
    min_duration: int,
    max_duration: int,
    source_context: dict | None = None,
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
        title = str(raw.get("title") or "Corte sugerido").strip()[:100]
        summary = str(raw.get("summary") or "").strip()[:500]
        youtube_tags = _candidate_hashtags(raw.get("hashtags") or raw.get("youtube_tags"), title, summary, source_context)
        candidates.append(
            ClipCandidate(
                id=f"clip-{uuid4().hex[:8]}",
                start=round(start, 2),
                end=round(end, 2),
                duration=round(duration, 2),
                title=_shorts_title(title, youtube_tags, summary),
                hook=str(raw.get("hook") or "").strip()[:200],
                summary=summary[:400],
                reason=str(raw.get("reason") or "").strip()[:500],
                scores=scores,
                youtube_tags=youtube_tags,
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
                visual_focus=candidate.visual_focus,
                youtube_tags=candidate.youtube_tags,
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
    source_context: dict | None = None,
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
        title = f"Trecho relevante {index + 1}"
        youtube_tags = _candidate_hashtags([], title, text[:320], source_context)
        windows.append(
            ClipCandidate(
                id=f"clip-fallback-{index + 1}",
                start=round(real_start, 2),
                end=round(real_end, 2),
                duration=round(duration, 2),
                title=_shorts_title(title, youtube_tags, text),
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
                youtube_tags=youtube_tags,
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


def _candidate_hashtags(raw_tags, title: str, summary: str, source_context: dict | None = None) -> list[str]:
    tags: list[str] = []

    def add(value: object) -> None:
        clean = _clean_hashtag(value)
        if clean and clean.lower() not in {tag.lower() for tag in tags}:
            tags.append(clean)

    context = source_context if isinstance(source_context, dict) else {}
    source_tags = context.get("tags") if isinstance(context.get("tags"), list) else []
    channel = str(context.get("channel") or context.get("uploader") or "").strip()
    text = _normalize_text(
        " ".join(
            [
                title,
                summary,
                str(context.get("title") or ""),
                channel,
                " ".join(str(item) for item in context.get("categories", []) or []),
                " ".join(str(tag) for tag in source_tags[:30]),
            ]
        )
    )

    if _looks_like_comedy(text):
        for tag in ("StandUp", "Comedia", "Humor", "Brasil"):
            add(tag)
    if "sao paulo" in text or re.search(r"\bsp\b", text):
        for tag in ("SaoPaulo", "SP", "Brasil"):
            add(tag)
    if "ferrari 458" in text:
        for tag in ("Ferrari458", "Ferrari", "Supercarros"):
            add(tag)
    elif "ferrari" in text:
        for tag in ("Ferrari", "Supercarros"):
            add(tag)
    if any(term in text for term in ("carro", "oficina", "motor", "roda", "automotivo")):
        for tag in ("Carros", "Automotivo"):
            add(tag)

    for tag in raw_tags or []:
        add(tag)
        if len(tags) >= 10:
            break
    add(channel)
    for tag in source_tags:
        add(tag)
        if len(tags) >= 10:
            break
    for tag in _keyword_hashtags(text):
        add(tag)
        if len(tags) >= 10:
            break

    return tags[:10]


def _shorts_title(title: str, tags: list[str], summary: str) -> str:
    clean = re.sub(r"\s+", " ", title).strip() or "Corte imperdivel"
    if "#" in clean:
        return clean[:100]
    emoji = "" if _has_emoji(clean) else _emoji_for_text(f"{clean} {summary} {' '.join(tags)}")
    suffix_tags = [f"#{tag}" for tag in tags[:3] if tag]
    suffix = " ".join(part for part in [emoji, *suffix_tags] if part).strip()
    if not suffix:
        return clean[:100]
    available = max(20, 100 - len(suffix) - 1)
    return f"{clean[:available].rstrip(' ,.;:-')} {suffix}".strip()[:100]


def _clean_hashtag(value: object) -> str:
    text = str(value or "").strip().lstrip("#")
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    words = [word for word in re.split(r"[\s_-]+", text) if word]
    if not words:
        return ""
    compact = "".join(word[:1].upper() + word[1:] for word in words)[:60]
    blocked = {
        "Shorts",
        "Youtube",
        "Podcast",
        "Video",
        "Clip",
        "Corte",
        "Viral",
        "Trending",
    }
    return "" if compact in blocked or len(compact) < 3 else compact


def _keyword_hashtags(text: str) -> list[str]:
    stopwords = {
        "sobre",
        "porque",
        "como",
        "esse",
        "essa",
        "muito",
        "mais",
        "menos",
        "video",
        "trecho",
        "corte",
        "clipe",
        "momento",
        "voce",
        "para",
        "fala",
        "falando",
    }
    tags: list[str] = []
    for word in re.findall(r"[a-z0-9]{4,}", text):
        if word in stopwords or word.isdigit() or word in tags:
            continue
        tags.append(word[:1].upper() + word[1:])
        if len(tags) >= 8:
            break
    return tags


def _looks_like_comedy(text: str) -> bool:
    return any(
        term in text
        for term in (
            "stand up",
            "standup",
            "comedia",
            "comedy",
            "humor",
            "piada",
            "plateia",
            "risada",
            "palco",
            "show de humor",
            "comediante",
        )
    )


def _emoji_for_text(text: str) -> str:
    normalized = _normalize_text(text)
    if _looks_like_comedy(normalized):
        return "😂"
    if any(term in normalized for term in ("carro", "ferrari", "motor", "oficina")):
        return "🏎️"
    if any(term in normalized for term in ("absurdo", "impossivel", "incrivel", "segredo")):
        return "🤯"
    return "🔥"


def _has_emoji(text: str) -> bool:
    return any(ord(char) > 10_000 for char in text)


def _normalize_text(text: str) -> str:
    normalized = text.lower()
    normalized = normalized.replace("á", "a").replace("à", "a").replace("ã", "a").replace("â", "a")
    normalized = normalized.replace("é", "e").replace("ê", "e").replace("í", "i")
    normalized = normalized.replace("ó", "o").replace("ô", "o").replace("õ", "o")
    normalized = normalized.replace("ú", "u").replace("ç", "c")
    return normalized
