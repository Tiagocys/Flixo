import os
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

from app.services.clipper.models import TranscriptSegment
from app.services.clipper.subtitle_layout import format_subtitle_segments, normalize_subtitle_style, write_srt
from app.services.clipper.transcriber import parse_srt
from app.services.podcast.renderer import (
    normalize_subtitle_color,
    normalize_subtitle_position,
    normalize_subtitle_size,
    render_podcast_clip,
    reburn_podcast_subtitles,
)
from app.utils import utils


_EDIT_CRF = os.getenv("PODCAST_EDIT_CRF", "20")
_EDIT_AUDIO_BITRATE = os.getenv("PODCAST_EDIT_AUDIO_BITRATE", "160k")


def edit_podcast_output(
    job_id: str,
    output: dict[str, Any],
    outputs: list[dict[str, Any]],
    trim_start: float,
    trim_end: float | None,
    recover_before: float = 0,
    recover_after: float = 0,
    append_output_id: str | None = None,
    append_position: str = "after",
    timeline_project: dict[str, Any] | None = None,
    source_file: str | None = None,
    transcript: list[TranscriptSegment] | None = None,
) -> dict[str, Any]:
    if timeline_project:
        return edit_podcast_timeline_output(job_id, output, outputs, timeline_project)

    recover_before = max(0.0, float(recover_before or 0))
    recover_after = max(0.0, float(recover_after or 0))
    if recover_before > 0 or recover_after > 0:
        return _edit_podcast_output_from_source(
            output=output,
            trim_start=trim_start,
            trim_end=trim_end,
            recover_before=recover_before,
            recover_after=recover_after,
            source_file=source_file,
            transcript=transcript or [],
        )

    video_path = Path(str(output.get("video_path") or "")).resolve()
    subtitle_path = Path(str(output.get("subtitle_path") or "")).resolve()
    camera_path = _camera_path(video_path)
    if not camera_path.is_file():
        raise RuntimeError("Video base sem legenda nao encontrado. Renderize o short novamente.")
    if not subtitle_path.is_file():
        raise RuntimeError("Arquivo SRT do short nao encontrado.")

    duration = _probe_duration(str(camera_path)) or float(output.get("duration") or 0)
    start = max(0.0, min(float(trim_start), max(0.0, duration - 0.1)))
    end = max(start + 0.1, min(float(trim_end or duration), duration))
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

    subtitle_style = normalize_subtitle_style(str(output.get("subtitle_style") or "standard"))
    subtitle_text_color = normalize_subtitle_color(str(output.get("subtitle_text_color") or "white"), "white")
    subtitle_border_color = normalize_subtitle_color(str(output.get("subtitle_border_color") or "black"), "black")
    subtitle_size = normalize_subtitle_size(str(output.get("subtitle_size") or "medium"))
    subtitle_position = normalize_subtitle_position(str(output.get("subtitle_position") or "middle"))
    write_srt(format_subtitle_segments(subtitle_segments, "standard"), str(edit_subtitle_path))
    burn_subtitles = bool(output.get("burn_subtitles", True))
    render_result = reburn_podcast_subtitles(
        camera_path=str(edit_camera_path),
        subtitle_path=str(edit_subtitle_path),
        output_path=str(edit_video_path),
        burn_subtitles=burn_subtitles,
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        watermark_enabled=bool(output.get("watermark_enabled", True)),
    )

    edited_duration = render_result.get("duration") or _probe_duration(str(edit_video_path))
    title = str(output.get("title") or "Podcast short").strip()
    cover_title = _clean_edited_suffix(str(output.get("cover_title") or title).strip())
    return {
        **output,
        "id": f"{output.get('id')}-{version}",
        "title": f"{title} (editado)"[:90],
        "cover_title": cover_title[:80],
        "duration": edited_duration,
        "source_duration": edited_duration,
        "removed_silence_seconds": output.get("removed_silence_seconds", 0),
        "video_path": str(edit_video_path),
        "subtitle_path": str(edit_subtitle_path),
        "video_url": _task_url(str(edit_video_path)),
        "subtitle_url": _task_url(str(edit_subtitle_path)),
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "watermark_enabled": bool(output.get("watermark_enabled", True)),
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


def _edit_podcast_output_from_source(
    output: dict[str, Any],
    trim_start: float,
    trim_end: float | None,
    recover_before: float,
    recover_after: float,
    source_file: str | None,
    transcript: list[TranscriptSegment],
) -> dict[str, Any]:
    if not source_file or not Path(source_file).is_file():
        raise RuntimeError("Video original indisponivel para recuperar segundos. Gere o projeto novamente.")

    candidate_start = max(0.0, float(output.get("start") or 0))
    candidate_end = float(output.get("end") or 0)
    if candidate_end <= candidate_start:
        candidate_end = candidate_start + max(0.1, float(output.get("source_duration") or output.get("duration") or 0))
    candidate_duration = max(0.1, candidate_end - candidate_start)
    rendered_duration = max(0.1, float(output.get("duration") or candidate_duration))

    start = max(0.0, min(float(trim_start or 0), max(0.0, rendered_duration - 0.1)))
    end = max(start + 0.1, min(float(trim_end or rendered_duration), rendered_duration))
    source_trim_start = candidate_start + (start / rendered_duration) * candidate_duration
    source_trim_end = candidate_start + (end / rendered_duration) * candidate_duration

    source_duration = _probe_duration(source_file) or 0.0
    final_start = max(0.0, source_trim_start - recover_before)
    final_end = source_trim_end + recover_after
    if source_duration > 0:
        final_end = min(final_end, source_duration)
    if final_end - final_start < 1.0:
        raise RuntimeError("O corte editado precisa ter pelo menos 1 segundo.")

    video_path = Path(str(output.get("video_path") or "")).resolve()
    base = video_path.with_suffix("")
    version = f"edit-{int(time.time())}"
    edit_base = base.parent / f"{base.name}-{version}"
    edit_video_path = edit_base.with_suffix(".mp4")

    subtitle_style = normalize_subtitle_style(str(output.get("subtitle_style") or "standard"))
    subtitle_text_color = normalize_subtitle_color(str(output.get("subtitle_text_color") or "white"), "white")
    subtitle_border_color = normalize_subtitle_color(str(output.get("subtitle_border_color") or "black"), "black")
    subtitle_size = normalize_subtitle_size(str(output.get("subtitle_size") or "medium"))
    subtitle_position = normalize_subtitle_position(str(output.get("subtitle_position") or "middle"))
    burn_subtitles = bool(output.get("burn_subtitles", True))
    title = str(output.get("title") or "Podcast short").strip()

    render_result = render_podcast_clip(
        source_video=source_file,
        start=final_start,
        end=final_end,
        transcript=transcript,
        output_path=str(edit_video_path),
        title=title,
        burn_subtitles=burn_subtitles,
        remove_silence=True,
        artificial_cuts=True,
        clip_format=str(output.get("clip_format") or "auto"),
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        watermark_enabled=bool(output.get("watermark_enabled", True)),
    )

    edited_duration = render_result.get("duration") or _probe_duration(str(edit_video_path))
    edit_subtitle_path = Path(str(render_result.get("subtitle_path") or edit_base.with_suffix(".srt")))
    cover_title = _clean_edited_suffix(str(output.get("cover_title") or title).strip())
    return {
        **output,
        "id": f"{output.get('id')}-{version}",
        "title": f"{title} (editado)"[:90],
        "cover_title": cover_title[:80],
        "start": round(final_start, 3),
        "end": round(final_end, 3),
        "duration": edited_duration,
        "source_duration": round(final_end - final_start, 3),
        "removed_silence_seconds": render_result.get("removed_silence_seconds", 0),
        "video_path": str(edit_video_path),
        "subtitle_path": str(edit_subtitle_path),
        "video_url": _task_url(str(edit_video_path)),
        "subtitle_url": _task_url(str(edit_subtitle_path)),
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "clip_format": render_result.get("clip_format") or output.get("clip_format") or "auto",
        "visual_focus": render_result.get("visual_focus") or {},
        "edited_from": output.get("id"),
        "edited_at": int(time.time()),
        "subtitle_edited_at": int(time.time()),
        "edit": {
            "trim_start": round(start, 2),
            "trim_end": round(end, 2),
            "recover_before": round(recover_before, 2),
            "recover_after": round(recover_after, 2),
        },
    }


def edit_podcast_timeline_output(
    job_id: str,
    output: dict[str, Any],
    outputs: list[dict[str, Any]],
    timeline_project: dict[str, Any],
) -> dict[str, Any]:
    project = _normalize_timeline_project(timeline_project, output, outputs)
    clips = _timeline_video_clips(project)
    if not clips:
        raise RuntimeError("Timeline sem clipes de video.")

    video_path = Path(str(output.get("video_path") or "")).resolve()
    base = video_path.with_suffix("")
    version = f"edit-{int(time.time())}"
    edit_base = base.parent / f"{base.name}-{version}"
    edit_camera_path = edit_base.with_suffix(".camera.mp4")
    edit_video_path = edit_base.with_suffix(".mp4")
    edit_subtitle_path = edit_base.with_suffix(".srt")
    temp_dir = edit_base.parent / f"{edit_base.name}.parts"
    temp_dir.mkdir(parents=True, exist_ok=True)

    outputs_by_id = {str(item.get("id") or ""): dict(item) for item in outputs}
    output_id = str(output.get("id") or "")
    if output_id:
        outputs_by_id[output_id] = dict(output)

    parts: list[tuple[str, list[TranscriptSegment]]] = []
    offset = 0.0
    for index, clip in enumerate(clips, start=1):
        asset = _timeline_asset(project, str(clip.get("assetId") or ""))
        asset_output = _output_for_asset(asset, outputs_by_id)
        asset_video_path = Path(str(asset_output.get("video_path") or "")).resolve()
        asset_subtitle_path = Path(str(asset_output.get("subtitle_path") or "")).resolve()
        asset_camera_path = _camera_path(asset_video_path)
        if not asset_camera_path.is_file():
            raise RuntimeError("Um asset da timeline nao possui video base sem legenda.")
        if not asset_subtitle_path.is_file():
            raise RuntimeError("Um asset da timeline nao possui arquivo SRT.")

        asset_duration = _probe_duration(str(asset_camera_path)) or float(asset_output.get("duration") or 0)
        source_in = max(0.0, min(float(clip.get("sourceIn") or 0), max(0.0, asset_duration - 0.1)))
        source_out = max(source_in + 0.1, min(float(clip.get("sourceOut") or asset_duration), asset_duration))
        duration = source_out - source_in
        if duration < 0.1:
            continue

        part_path = temp_dir / f"part-{index}.mp4"
        _cut_video(str(asset_camera_path), source_in, duration, str(part_path))
        raw_segments = _trim_srt_segments(asset_subtitle_path, source_in, source_out)
        shifted_segments = [
            TranscriptSegment(
                start=round(segment.start + offset, 3),
                end=round(segment.end + offset, 3),
                text=segment.text,
            )
            for segment in raw_segments
        ]
        parts.append((str(part_path), shifted_segments))
        offset += _probe_duration(str(part_path)) or duration

    if not parts or offset < 1.0:
        raise RuntimeError("A composicao editada precisa ter pelo menos 1 segundo.")

    if len(parts) == 1:
        os.replace(parts[0][0], edit_camera_path)
    else:
        _concat_videos([path for path, _segments in parts], str(edit_camera_path))

    subtitle_segments: list[TranscriptSegment] = []
    for _path, segments in parts:
        subtitle_segments.extend(segments)

    subtitle_style = normalize_subtitle_style(str(output.get("subtitle_style") or "standard"))
    subtitle_text_color = normalize_subtitle_color(str(output.get("subtitle_text_color") or "white"), "white")
    subtitle_border_color = normalize_subtitle_color(str(output.get("subtitle_border_color") or "black"), "black")
    subtitle_size = normalize_subtitle_size(str(output.get("subtitle_size") or "medium"))
    subtitle_position = normalize_subtitle_position(str(output.get("subtitle_position") or "middle"))
    write_srt(format_subtitle_segments(subtitle_segments, "standard"), str(edit_subtitle_path))
    burn_subtitles = bool(output.get("burn_subtitles", True))
    render_result = reburn_podcast_subtitles(
        camera_path=str(edit_camera_path),
        subtitle_path=str(edit_subtitle_path),
        output_path=str(edit_video_path),
        burn_subtitles=burn_subtitles,
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        watermark_enabled=bool(output.get("watermark_enabled", True)),
    )

    edited_duration = render_result.get("duration") or _probe_duration(str(edit_video_path))
    title = str(output.get("title") or "Podcast short").strip()
    cover_title = _clean_edited_suffix(str(output.get("cover_title") or title).strip())
    return {
        **output,
        "id": f"{output.get('id')}-{version}",
        "title": f"{title} (editado)"[:90],
        "cover_title": cover_title[:80],
        "duration": edited_duration,
        "source_duration": edited_duration,
        "removed_silence_seconds": output.get("removed_silence_seconds", 0),
        "video_path": str(edit_video_path),
        "subtitle_path": str(edit_subtitle_path),
        "video_url": _task_url(str(edit_video_path)),
        "subtitle_url": _task_url(str(edit_subtitle_path)),
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "edited_from": output.get("id"),
        "edited_at": int(time.time()),
        "subtitle_edited_at": int(time.time()),
        "timeline_project": project,
        "edit": {
            "type": "timeline",
            "clips": len(clips),
            "duration": round(float(edited_duration or offset), 3),
        },
    }


def _normalize_timeline_project(
    project: dict[str, Any],
    output: dict[str, Any],
    outputs: list[dict[str, Any]],
) -> dict[str, Any]:
    assets = project.get("assets") if isinstance(project.get("assets"), list) else []
    tracks = project.get("tracks") if isinstance(project.get("tracks"), list) else []
    normalized_assets = []
    known_output_ids = {str(item.get("id") or "") for item in outputs}
    known_output_ids.add(str(output.get("id") or ""))

    for asset in assets:
        if not isinstance(asset, dict):
            continue
        asset_id = str(asset.get("id") or "").strip()
        source_output_id = str(asset.get("sourceOutputId") or asset.get("source_output_id") or "").strip()
        if not asset_id or not source_output_id or source_output_id not in known_output_ids:
            continue
        normalized_assets.append(
            {
                "id": asset_id,
                "type": "video",
                "name": str(asset.get("name") or source_output_id)[:120],
                "duration": round(max(0.0, float(asset.get("duration") or 0)), 3),
                "sourceOutputId": source_output_id,
                "videoUrl": str(asset.get("videoUrl") or asset.get("video_url") or ""),
                "subtitleUrl": str(asset.get("subtitleUrl") or asset.get("subtitle_url") or ""),
            }
        )

    if not normalized_assets:
        output_id = str(output.get("id") or "asset")
        normalized_assets = [
            {
                "id": f"asset-{output_id}",
                "type": "video",
                "name": str(output.get("title") or "Clipe")[:120],
                "duration": round(max(0.0, float(output.get("duration") or 0)), 3),
                "sourceOutputId": output_id,
                "videoUrl": str(output.get("video_url") or ""),
                "subtitleUrl": str(output.get("subtitle_url") or ""),
            }
        ]

    asset_ids = {asset["id"] for asset in normalized_assets}
    normalized_tracks = []
    for track in tracks:
        if not isinstance(track, dict):
            continue
        track_id = str(track.get("id") or "v1").strip() or "v1"
        track_type = str(track.get("type") or "video").strip() or "video"
        clips = track.get("clips") if isinstance(track.get("clips"), list) else []
        normalized_clips = []
        for clip in clips:
            if not isinstance(clip, dict):
                continue
            asset_id = str(clip.get("assetId") or "").strip()
            if asset_id not in asset_ids:
                continue
            source_in = max(0.0, float(clip.get("sourceIn") or 0))
            source_out = max(source_in + 0.1, float(clip.get("sourceOut") or source_in + float(clip.get("duration") or 0)))
            duration = max(0.1, source_out - source_in)
            normalized_clips.append(
                {
                    "id": str(clip.get("id") or f"clip-{len(normalized_clips) + 1}"),
                    "assetId": asset_id,
                    "sourceIn": round(source_in, 3),
                    "sourceOut": round(source_out, 3),
                    "timelineStart": round(max(0.0, float(clip.get("timelineStart") or 0)), 3),
                    "duration": round(duration, 3),
                }
            )
        normalized_tracks.append({"id": track_id, "type": track_type, "clips": normalized_clips})

    if not normalized_tracks:
        asset = normalized_assets[0]
        duration = max(0.1, float(asset.get("duration") or 0))
        normalized_tracks = [
            {
                "id": "v1",
                "type": "video",
                "clips": [
                    {
                        "id": "clip-1",
                        "assetId": asset["id"],
                        "sourceIn": 0.0,
                        "sourceOut": round(duration, 3),
                        "timelineStart": 0.0,
                        "duration": round(duration, 3),
                    }
                ],
            }
        ]

    return {
        "version": 1,
        "assets": normalized_assets,
        "tracks": normalized_tracks,
        "playhead": round(max(0.0, float(project.get("playhead") or 0)), 3),
    }


def _timeline_video_clips(project: dict[str, Any]) -> list[dict[str, Any]]:
    tracks = project.get("tracks") if isinstance(project.get("tracks"), list) else []
    for track in tracks:
        if not isinstance(track, dict) or str(track.get("type") or "video") != "video":
            continue
        clips = track.get("clips") if isinstance(track.get("clips"), list) else []
        return sorted((dict(clip) for clip in clips if isinstance(clip, dict)), key=lambda clip: float(clip.get("timelineStart") or 0))
    return []


def _timeline_asset(project: dict[str, Any], asset_id: str) -> dict[str, Any]:
    assets = project.get("assets") if isinstance(project.get("assets"), list) else []
    for asset in assets:
        if isinstance(asset, dict) and str(asset.get("id") or "") == asset_id:
            return asset
    raise RuntimeError("Asset da timeline nao encontrado.")


def _output_for_asset(asset: dict[str, Any], outputs_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    output_id = str(asset.get("sourceOutputId") or asset.get("source_output_id") or "")
    output = outputs_by_id.get(output_id)
    if not output:
        raise RuntimeError("Output de origem do asset nao encontrado.")
    return output


def _clean_edited_suffix(value: str) -> str:
    cleaned = value.strip()
    while cleaned.lower().endswith("(editado)"):
        cleaned = cleaned[:-9].strip()
    return cleaned or "Podcast short"


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
            _EDIT_CRF,
            "-c:a",
            "aac",
            "-b:a",
            _EDIT_AUDIO_BITRATE,
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
            _EDIT_CRF,
            "-c:a",
            "aac",
            "-b:a",
            _EDIT_AUDIO_BITRATE,
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
