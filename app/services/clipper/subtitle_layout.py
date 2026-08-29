import re
from math import ceil, floor

from app.services.clipper.models import TranscriptSegment
from app.utils import utils


_BREAK_AFTER_RE = re.compile(r"([,;:.!?])$")
_WORD_SUBTITLE_MAX_CHARS = 12


def compact_subtitle_segments(
    segments: list[TranscriptSegment],
    max_chars: int = 24,
    min_duration: float = 0.75,
) -> list[TranscriptSegment]:
    compacted: list[TranscriptSegment] = []
    for segment in segments:
        text = " ".join(segment.text.split())
        words = text.split()
        duration = max(0.1, segment.end - segment.start)
        chunk_count = _chunk_count(text, duration, max_chars, min_duration)
        if not words or chunk_count <= 1:
            compacted.append(
                TranscriptSegment(start=segment.start, end=segment.end, text=text)
            )
            continue

        chunks = _split_words(words, chunk_count)
        cursor = segment.start
        chunk_duration = duration / len(chunks)

        for index, chunk in enumerate(chunks):
            end = segment.end if index == len(chunks) - 1 else cursor + chunk_duration
            compacted.append(
                TranscriptSegment(
                    start=round(cursor, 3),
                    end=round(end, 3),
                    text=" ".join(chunk),
                )
            )
            cursor = end
    return compacted


def word_by_word_segments(
    segments: list[TranscriptSegment],
) -> list[TranscriptSegment]:
    words_only: list[TranscriptSegment] = []
    for segment in segments:
        text = " ".join(segment.text.split())
        words = text.split()
        if not words:
            continue
        duration = max(0.1, segment.end - segment.start)
        word_duration = duration / len(words)
        cursor = segment.start
        for index, word in enumerate(words):
            end = segment.end if index == len(words) - 1 else cursor + word_duration
            if end <= cursor:
                continue
            words_only.append(
                TranscriptSegment(
                    start=round(cursor, 3),
                    end=round(end, 3),
                    text=_format_word_subtitle(word),
                )
            )
            cursor = end
    return words_only


def format_subtitle_segments(
    segments: list[TranscriptSegment],
    subtitle_style: str = "standard",
) -> list[TranscriptSegment]:
    if normalize_subtitle_style(subtitle_style) == "word":
        return word_by_word_segments(segments)
    return compact_subtitle_segments(segments)


def normalize_subtitle_style(value: str | None) -> str:
    return "word" if str(value or "").strip().lower() in {"word", "word_by_word", "word-by-word"} else "standard"


def _format_word_subtitle(word: str) -> str:
    clean = word.strip()
    if len(clean) <= _WORD_SUBTITLE_MAX_CHARS:
        return clean
    leading = re.match(r"^\W+", clean)
    trailing = re.search(r"\W+$", clean)
    prefix = leading.group(0) if leading else ""
    suffix = trailing.group(0) if trailing else ""
    core_start = len(prefix)
    core_end = len(clean) - len(suffix) if suffix else len(clean)
    core = clean[core_start:core_end]
    if len(core) <= _WORD_SUBTITLE_MAX_CHARS:
        return clean
    split_at = _balanced_word_split(core)
    return f"{prefix}{core[:split_at]}-\n{core[split_at:]}{suffix}"


def _balanced_word_split(word: str) -> int:
    midpoint = max(1, len(word) // 2)
    candidates = [midpoint]
    vowels = "aeiouáéíóúâêôãõàüAEIOUÁÉÍÓÚÂÊÔÃÕÀÜ"
    for offset in range(0, max(1, len(word))):
        for index in (midpoint - offset, midpoint + offset):
            if 3 <= index <= len(word) - 3 and word[index - 1] in vowels:
                candidates.append(index)
    return min(candidates, key=lambda index: (abs(index - midpoint), index))


def write_srt(segments: list[TranscriptSegment], output_path: str) -> str:
    lines = [
        utils.text_to_srt(index, segment.text, segment.start, segment.end).strip()
        for index, segment in enumerate(segments, start=1)
    ]
    with open(output_path, "w", encoding="utf-8") as file:
        file.write("\n\n".join(lines).strip() + "\n")
    return output_path


def _chunk_count(
    text: str,
    duration: float,
    max_chars: int,
    min_duration: float,
) -> int:
    by_length = max(1, ceil(len(text) / max_chars))
    by_time = max(1, floor(duration / min_duration))
    return max(1, min(by_length, by_time))


def _split_words(words: list[str], chunk_count: int) -> list[list[str]]:
    if chunk_count <= 1 or len(words) <= 1:
        return [words]

    chunks: list[list[str]] = []
    remaining = words[:]

    for index in range(chunk_count):
        remaining_chunks = chunk_count - index
        if remaining_chunks == 1:
            chunks.append(remaining)
            break

        target_len = ceil(_words_len(remaining) / remaining_chunks)
        min_words_for_rest = remaining_chunks - 1
        max_take = max(1, len(remaining) - min_words_for_rest)
        take = _best_break_index(remaining, target_len, max_take)
        chunks.append(remaining[:take])
        remaining = remaining[take:]

    return chunks


def _best_break_index(words: list[str], target_len: int, max_take: int) -> int:
    best_index = 1
    best_score = float("inf")

    for take in range(1, max_take + 1):
        chunk = words[:take]
        length_score = abs(_words_len(chunk) - target_len)
        punctuation_bonus = 5 if _BREAK_AFTER_RE.search(chunk[-1]) else 0
        orphan_penalty = 12 if take == 1 and max_take > 1 else 0
        score = length_score - punctuation_bonus + orphan_penalty
        if score < best_score:
            best_score = score
            best_index = take

    return best_index


def _words_len(words: list[str]) -> int:
    return len(" ".join(words))
