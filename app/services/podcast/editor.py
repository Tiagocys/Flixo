import os
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

from app.services.clipper.models import TranscriptSegment
from app.services.clipper.subtitle_layout import compact_subtitle_segments, write_srt
from app.services.clipper.transcriber import parse_srt
from app.services.podcast.renderer import reburn_podcast_subtitles
from app.utils import utils


def edit_podcast_output(
    job_id: str,
    output: dict[str, Any],
    outputs: list[dict[str, Any]],
    trim_start: float,
    trim_end: float,
    append_output_id: str | None = None,
    append_position: str = "after",
) -> dict[str, Any]:
    video_path = Path(str(output.get("video_path") or "")).resolve()
    subtitle_path = Path(str(output.get("subtitle_path") or "")).resolve()
    camera_path = _camera_path(video_path)
    if not camera_path.is_file():
        raise RuntimeError("Video base sem legenda nao encontrado. Renderize o short novamente.")
    if not subtitle_path.is_file():
        raise RuntimeError("Arquivo SRT do short nao encontrado.")

    duration = _probe_duration(str(camera_path)) or float(output.get("duration") or 0)
    start = max(0.0, min(float(trim_start), max(0.0, duration - 0.1)))
    end = max(start + 0.1, min(float(trim_end), duration))
    if end - start < 1.0:
        raise RuntimeError("O corte editado precisa ter pelo menos 1 segundo.")

    append_output = _find_output(outputs, append_output_id) if append_output_id else None
    position = append_position if append_position in {"before", "after"} else "after"

    base = video_path.with_suffix("")
    version = f"edit-{int(time.time())}"
    edit_base = base.parent / f"{base.name}-{version}"
    edit_camera_path = edit_base.with_suffix(".camera.mp4")
    edit_video_path = edit_base.with_suffix(".mp4")
    edit_subtitle_path = edit_base.with_suffix(".srt")

    temp_dir = edit_base.parent / f"{edit_base.name}.parts"
    temp_dir.mkdir(parents=True, exist_ok=True)

    current_part = temp_dir / "current.mp4"
    _cut_video(str(camera_path), start, end - start, str(current_part))
    parts = [(str(current_part), _trim_srt_segments(subtitle_path, start, end))]

    if append_output:
        append_video_path = Path(str(append_output.get("video_path") or "")).resolve()
        append_subtitle_path = Path(str(append_output.get("subtitle_path") or "")).resolve()
        append_camera_path = _camera_path(append_video_path)
        if not append_camera_path.is_file() or not append_subtitle_path.is_file():
            raise RuntimeError("O clipe complementar nao possui camera base ou SRT.")
        append_duration = _probe_duration(str(append_camera_path)) or float(append_output.get("duration") or 0)
        append_part = temp_dir / "append.mp4"
        _cut_video(str(append_camera_path), 0.0, append_duration, str(append_part))
        append_segments = _trim_srt_segments(append_subtitle_path, 0.0, append_duration)
        if position == "before":
            parts = [(str(append_part), append_segments), *parts]
        else:
            parts = [*parts, (str(append_part), append_segments)]

    if len(parts) == 1:
        os.replace(parts[0][0], edit_camera_path)
    else:
        _concat_videos([path for path, _segments in parts], str(edit_camera_path))

    subtitle_segments: list[TranscriptSegment] = []
    offset = 0.0
    for path, segments in parts:
        part_duration = _probe_duration(path) or _segments_duration(segments)
        subtitle_segments.extend(
            TranscriptSegment(
                start=round(segment.start + offset, 3),
                end=round(segment.end + offset, 3),
                text=segment.text,
            )
            for segment in segments
        )
        offset += part_duration

    write_srt(compact_subtitle_segments(subtitle_segments), str(edit_subtitle_path))
    burn_subtitles = bool(output.get("burn_subtitles", True))
    render_result = reburn_podcast_subtitles(
        camera_path=str(edit_camera_path),
        subtitle_path=str(edit_subtitle_path),
        output_path=str(edit_video_path),
        burn_subtitles=burn_subtitles,
    )

    edited_duration = render_result.get("duration") or _probe_duration(str(edit_video_path))
    title = str(output.get("title") or "Podcast short").strip()
    return {
        **output,
        "id": f"{output.get('id')}-{version}",
        "title": f"{title} (editado)"[:90],
        "duration": edited_duration,
        "source_duration": edited_duration,
        "removed_silence_seconds": output.get("removed_silence_seconds", 0),
        "video_path": str(edit_video_path),
        "subtitle_path": str(edit_subtitle_path),
        "video_url": _task_url(str(edit_video_path)),
        "subtitle_url": _task_url(str(edit_subtitle_path)),
        "burn_subtitles": burn_subtitles,
        "edited_from": output.get("id"),
        "edited_at": int(time.time()),
        "subtitle_edited_at": int(time.time()),
        "edit": {
            "trim_start": round(start, 2),
            "trim_end": round(end, 2),
            "append_output_id": append_output_id or "",
            "append_position": position if append_output else "",
        },
    }


def _find_output(outputs: list[dict[str, Any]], output_id: str | None) -> dict[str, Any] | None:
    if not output_id:
        return None
    for output in outputs:
        if str(output.get("id") or "") == output_id:
            return dict(output)
    raise RuntimeError("Clipe complementar nao encontrado.")


def _camera_path(video_path: Path) -> Path:
    path = video_path.with_suffix("").with_suffix(".camera.mp4")
    if path.is_file():
        return path
    return Path(str(video_path).replace(".mp4", ".camera.mp4"))


def _trim_srt_segments(path: Path, start: float, end: float) -> list[TranscriptSegment]:
    segments = []
    for segment in parse_srt(str(path)):
        overlap_start = max(segment.start, start)
        overlap_end = min(segment.end, end)
        if overlap_end <= overlap_start:
            continue
        segments.append(
            TranscriptSegment(
                start=round(overlap_start - start, 3),
                end=round(overlap_end - start, 3),
                text=segment.text,
            )
        )
    return segments


def _cut_video(input_path: str, start: float, duration: float, output_path: str) -> None:
    _run(
        [
            utils.get_ffmpeg_binary(),
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            input_path,
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao cortar clipe editado",
    )


def _concat_videos(paths: list[str], output_path: str) -> None:
    list_path = Path(output_path).with_suffix(".concat.txt")
    with list_path.open("w", encoding="utf-8") as file:
        for path in paths:
            file.write(f"file {shlex.quote(str(Path(path).resolve()))}\n")
    _run(
        [
            utils.get_ffmpeg_binary(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao concatenar clipes editados",
    )


def _probe_duration(path: str) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return round(float(result.stdout.strip()), 2)
    except ValueError:
        return 0.0


def _segments_duration(segments: list[TranscriptSegment]) -> float:
    return max((segment.end for segment in segments), default=0.0)


def _task_url(path: str) -> str:
    normalized = path.replace("\\", "/")
    marker = "/storage/tasks/"
    if marker not in normalized:
        return normalized
    return "/tasks/" + normalized.split(marker, 1)[1]


def _run(command: list[str], message: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{message}: {detail[-900:]}")
