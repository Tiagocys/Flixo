import os
import re

from app.services.clipper.models import ClipCandidate, TranscriptSegment
from app.services.clipper.subtitle_layout import compact_subtitle_segments, write_srt
from app.services.clipper.transcriber import parse_srt, write_adjusted_srt
from app.services.clipper.vertical_formatter import render_vertical_clip


def render_selected_clips(
    source_video: str,
    segments: list[TranscriptSegment],
    candidates: list[ClipCandidate],
    selected_ids: list[str],
    output_dir: str,
    burn_subtitles: bool = True,
) -> list[dict]:
    by_id = {candidate.id: candidate for candidate in candidates}
    outputs = []
    for index, candidate_id in enumerate(selected_ids, start=1):
        candidate = by_id.get(candidate_id)
        if not candidate:
            continue
        clip_dir = os.path.join(output_dir, "outputs")
        os.makedirs(clip_dir, exist_ok=True)
        subtitle_path = os.path.join(clip_dir, f"clip-{index}.srt")
        video_path = os.path.join(clip_dir, f"clip-{index}.mp4")
        write_adjusted_srt(segments, candidate.start, candidate.end, subtitle_path)
        compacted_segments = compact_subtitle_segments(parse_srt(subtitle_path))
        write_srt(compacted_segments, subtitle_path)
        render_vertical_clip(
            source_video=source_video,
            start=candidate.start,
            duration=candidate.duration,
            subtitle_path=subtitle_path,
            output_path=video_path,
            title=candidate.title,
            burn_subtitles=burn_subtitles,
        )
        outputs.append(
            {
                "id": candidate.id,
                "title": candidate.title,
                "score": candidate.scores.get("overall", 0),
                "start": candidate.start,
                "end": candidate.end,
                "duration": candidate.duration,
                "hook": candidate.hook,
                "summary": candidate.summary,
                "public_description": _public_description(candidate, segments),
                "reason": candidate.reason,
                "video_path": video_path,
                "subtitle_path": subtitle_path,
                "video_url": _task_url(video_path),
                "subtitle_url": _task_url(subtitle_path),
            }
        )
    return outputs


def _public_description(
    candidate: ClipCandidate,
    segments: list[TranscriptSegment],
) -> str:
    if candidate.summary and not _looks_editorial(candidate.summary):
        return candidate.summary
    selected = [
        segment.text
        for segment in segments
        if segment.end >= candidate.start and segment.start <= candidate.end
    ]
    text = re.sub(r"\s+", " ", " ".join(selected)).strip()
    if not text:
        return f"Um momento curto sobre {candidate.title.lower()}."
    if len(text) > 260:
        text = text[:257].rsplit(" ", 1)[0].rstrip(".,;:") + "..."
    return text


def _looks_editorial(text: str) -> bool:
    normalized = text.lower()
    return any(
        term in normalized
        for term in (
            "retém",
            "retencao",
            "retenção",
            "espectador",
            "hook",
            "identificação imediata",
            "dor emocional",
            "criador",
            "criadores",
            "criando uma identificação",
            "gera confiança",
            "gera autoridade",
            "valor percebido",
            "alto valor",
            "chamada motivacional",
            "primeiros segundos",
            "ranking",
            "algoritmo",
            "payoff",
        )
    )


def _task_url(path: str) -> str:
    normalized = path.replace("\\", "/")
    marker = "/storage/tasks/"
    if marker not in normalized:
        return normalized
    return "/tasks/" + normalized.split(marker, 1)[1]
