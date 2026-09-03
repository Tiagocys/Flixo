import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from loguru import logger

from app.services.clipper.analyzer import analyze_transcript
from app.services.clipper.ingest import ingest_url
from app.services.clipper.metadata import write_job_metadata
from app.services.clipper.models import ClipCandidate, ClipperJob, TranscriptSegment, clipper_job_from_dict
from app.services.clipper.subtitle_layout import compact_subtitle_segments, normalize_subtitle_style
from app.services.clipper.transcriber import transcribe_video
from app.services.podcast import registry
from app.services.podcast.covers import (
    attach_cover_options,
    normalize_cover_template,
    normalize_cover_text_position,
)
from app.services.podcast.editor import edit_podcast_output
from app.services.podcast.ingest import job_dir
from app.services.podcast.renderer import (
    normalize_clip_format,
    normalize_subtitle_color,
    normalize_subtitle_position,
    normalize_subtitle_size,
    reburn_podcast_subtitles,
    render_podcast_clip,
)
from app.services import r2_storage
from app.services.ytdlp_runner import ytdlp_probe_metadata
from app.utils import utils


class PodcastJobCancelled(RuntimeError):
    pass


def analyze_job(job_id: str, source_url: str | None = None) -> None:
    try:
        output_dir = job_dir(job_id)
        job = registry.get_job(job_id)
        if not job:
            return
        _raise_if_cancelled(job_id)
        initial_eta = _fallback_initial_eta(source_url)

        def ingesting(current):
            current.status = "running"
            current.current_step = "ingesting"
            current.progress = 10
            current.step_started_at = time.time()
            current.estimated_remaining_seconds = initial_eta

        registry.update_job(job_id, ingesting)
        _raise_if_cancelled(job_id)
        source_metadata = _probe_source_metadata(source_url)
        if source_metadata:
            def attach_source_metadata(current):
                current.source_metadata = source_metadata
                if not current.original_name and source_metadata.get("title"):
                    current.original_name = str(source_metadata["title"])[:180]
                current.metadata_path = write_job_metadata(current, output_dir)

            registry.update_job(job_id, attach_source_metadata)
        initial_eta = _initial_analysis_eta(source_url, job.source_file, source_metadata)
        registry.update_job(job_id, lambda current: setattr(current, "estimated_remaining_seconds", initial_eta))
        source_file = job.source_file
        if source_url:
            source_file = ingest_url(source_url, output_dir)
        _raise_if_cancelled(job_id)

        def transcribing(current):
            current.source_file = source_file
            current.current_step = "transcribing"
            current.progress = 35
            current.step_started_at = time.time()
            current.estimated_remaining_seconds = _remaining_from_total(current.created_at, initial_eta)

        registry.update_job(job_id, transcribing)
        _raise_if_cancelled(job_id)

        def update_transcription_progress(_start, end, _text, duration):
            if registry.is_cancelled(job_id):
                return
            if not duration:
                return
            percent = max(0.0, min(1.0, float(end) / float(duration)))

            def apply(current):
                if current.current_step == "transcribing":
                    current.progress = max(current.progress, 35 + int(percent * 30))
                    current.estimated_remaining_seconds = max(
                        _remaining_from_total(current.created_at, initial_eta),
                        _eta_from_percent(current.step_started_at, percent, minimum_seconds=60) or 0,
                    )

            registry.update_job(job_id, apply)

        transcript, _ = transcribe_video(
            source_file,
            output_dir,
            progress_callback=update_transcription_progress,
        )
        _raise_if_cancelled(job_id)

        def analyzing(current):
            current.transcript = transcript
            current.current_step = "analyzing"
            current.progress = 72
            current.step_started_at = time.time()
            current.estimated_remaining_seconds = _remaining_from_total(current.created_at, initial_eta, minimum=35)

        registry.update_job(job_id, analyzing)
        _raise_if_cancelled(job_id)
        candidates = analyze_transcript(
            transcript,
            max_candidates=10,
            min_duration=18,
            max_duration=90,
            source_context=_source_context(job, source_metadata),
        )
        candidates = _attach_candidate_preview_frames(source_file, output_dir, candidates)
        _raise_if_cancelled(job_id)

        def ready(current):
            current.candidates = candidates
            current.status = "ready"
            current.current_step = "ready"
            current.progress = 100
            current.estimated_remaining_seconds = None
            current.metadata_path = write_job_metadata(current, output_dir)

        registry.update_job(job_id, ready)
    except PodcastJobCancelled:
        logger.info(f"podcast analyze job cancelled: {job_id}")
    except Exception as error:
        logger.exception(f"podcast analyze job failed: {job_id}")
        registry.set_failed(job_id, str(error))


def render_job(
    job_id: str,
    selected_ids: list[str],
    burn_subtitles: bool = True,
    remove_silence: bool = True,
    artificial_cuts: bool = True,
    clip_format: str = "auto",
    subtitle_style: str = "standard",
    subtitle_text_color: str = "white",
    subtitle_border_color: str = "black",
    subtitle_size: str = "medium",
    subtitle_position: str = "middle",
    watermark_enabled: bool = True,
) -> None:
    try:
        job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
        if not job or not job.source_file:
            raise RuntimeError("Job de podcast nao encontrado ou sem video de origem.")
        if not selected_ids:
            raise RuntimeError("Selecione pelo menos um corte.")
        _raise_if_cancelled(job_id)
        subtitle_style = normalize_subtitle_style(subtitle_style)
        subtitle_text_color = normalize_subtitle_color(subtitle_text_color, "white")
        subtitle_border_color = normalize_subtitle_color(subtitle_border_color, "black")
        subtitle_size = normalize_subtitle_size(subtitle_size)
        subtitle_position = normalize_subtitle_position(subtitle_position)
        clip_format = normalize_clip_format(clip_format)

        output_dir = job_dir(job_id)

        def rendering(current):
            current.status = "rendering"
            current.current_step = "rendering"
            current.progress = 15
            current.step_started_at = time.time()
            current.estimated_remaining_seconds = max(60, len(selected_ids) * 45)

        registry.update_job(job_id, rendering)
        _raise_if_cancelled(job_id)
        candidates = {candidate.id: candidate for candidate in job.candidates}
        outputs = []
        output_path = os.path.join(output_dir, "outputs")
        os.makedirs(output_path, exist_ok=True)
        for index, candidate_id in enumerate(selected_ids, start=1):
            _raise_if_cancelled(job_id)
            candidate = candidates.get(candidate_id)
            if not candidate:
                continue
            video_path = os.path.join(output_path, f"podcast-{index}.mp4")
            render_result = render_podcast_clip(
                source_video=job.source_file,
                start=candidate.start,
                end=candidate.end,
                transcript=job.transcript,
                output_path=video_path,
                title=candidate.title,
                burn_subtitles=burn_subtitles,
                remove_silence=remove_silence,
                artificial_cuts=artificial_cuts,
                clip_format=clip_format,
                subtitle_style=subtitle_style,
                subtitle_text_color=subtitle_text_color,
                subtitle_border_color=subtitle_border_color,
                subtitle_size=subtitle_size,
                subtitle_position=subtitle_position,
                watermark_enabled=watermark_enabled,
            )
            outputs.append(_output_payload(candidate, render_result))
            _update_render_eta(job_id, index, len(selected_ids))
            _raise_if_cancelled(job_id)
        if not outputs:
            raise RuntimeError("Nenhum corte valido foi renderizado.")

        try:
            _raise_if_cancelled(job_id)
            attach_cover_options(output_dir, outputs, variants=3)
        except Exception:
            logger.exception(f"failed to generate podcast covers: {job_id}")
        _raise_if_cancelled(job_id)
        outputs = [_persist_output_assets(job_id, output) for output in outputs]

        def done(current):
            current.outputs = outputs
            current.status = "done"
            current.current_step = "done"
            current.progress = 100
            current.estimated_remaining_seconds = None
            current.metadata_path = write_job_metadata(current, output_dir)

        registry.update_job(job_id, done)
        registry.prune_idle_jobs_for_user(job.user_id, keep_job_id=job_id)
    except PodcastJobCancelled:
        logger.info(f"podcast render job cancelled: {job_id}")
    except Exception as error:
        logger.exception(f"podcast render job failed: {job_id}")
        registry.set_failed(job_id, str(error))


def _raise_if_cancelled(job_id: str) -> None:
    if registry.is_cancelled(job_id):
        raise PodcastJobCancelled("Processo interrompido pelo usuario.")


def _output_payload(candidate: ClipCandidate, render_result: dict) -> dict:
    video_path = render_result["video_path"]
    subtitle_path = render_result["subtitle_path"]
    title = str(candidate.title or "Short").strip()[:100]
    clean_cover_title = re.sub(r"\s*[🔥😂🤯🏎️]?\s*(?:#\w+\s*)+$", "", title).strip() or title
    return {
        "id": candidate.id,
        "title": title,
        "cover_title": clean_cover_title[:80],
        "score": candidate.scores.get("overall", 0),
        "start": candidate.start,
        "end": candidate.end,
        "duration": render_result.get("duration") or candidate.duration,
        "source_duration": candidate.duration,
        "removed_silence_seconds": render_result.get("removed_silence_seconds", 0),
        "burn_subtitles": bool(render_result.get("burn_subtitles", True)),
        "subtitle_style": render_result.get("subtitle_style") or "standard",
        "subtitle_text_color": render_result.get("subtitle_text_color") or "white",
        "subtitle_border_color": render_result.get("subtitle_border_color") or "black",
        "subtitle_size": render_result.get("subtitle_size") or "medium",
        "subtitle_position": render_result.get("subtitle_position") or "middle",
        "watermark_enabled": bool(render_result.get("watermark_enabled", True)),
        "clip_format": render_result.get("clip_format") or "auto",
        "hook": candidate.hook,
        "summary": candidate.summary,
        "public_description": candidate.summary,
        "youtube_tags": [str(tag).strip().lstrip("#") for tag in candidate.youtube_tags if str(tag).strip()][:12],
        "reason": candidate.reason,
        "visual_focus": render_result.get("visual_focus") or candidate.visual_focus,
        "video_path": video_path,
        "subtitle_path": subtitle_path,
        "video_url": _task_url(video_path),
        "subtitle_url": _task_url(subtitle_path),
    }


def _task_url(path: str) -> str:
    normalized = path.replace("\\", "/")
    marker = "/storage/tasks/"
    if marker not in normalized:
        return normalized
    return "/tasks/" + normalized.split(marker, 1)[1]


def _attach_candidate_preview_frames(
    source_file: str | None,
    output_dir: str,
    candidates: list[ClipCandidate],
) -> list[ClipCandidate]:
    if not source_file or not os.path.isfile(source_file) or not candidates:
        return candidates
    frames_dir = Path(output_dir) / "candidate_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    updated: list[ClipCandidate] = []
    for index, candidate in enumerate(candidates, start=1):
        safe_id = re.sub(r"[^a-zA-Z0-9_-]+", "-", candidate.id or f"candidate-{index}").strip("-")
        frame_path = frames_dir / f"{safe_id or f'candidate-{index}'}.jpg"
        try:
            if not frame_path.is_file():
                _extract_candidate_preview_frame(source_file, candidate, frame_path)
            if frame_path.is_file():
                updated.append(
                    ClipCandidate(
                        id=candidate.id,
                        start=candidate.start,
                        end=candidate.end,
                        duration=candidate.duration,
                        title=candidate.title,
                        hook=candidate.hook,
                        summary=candidate.summary,
                        reason=candidate.reason,
                        scores=candidate.scores,
                        visual_focus=candidate.visual_focus,
                        youtube_tags=candidate.youtube_tags,
                        preview_frame_path=str(frame_path),
                        preview_frame_url=_task_url(str(frame_path)),
                    )
                )
                continue
        except Exception:
            logger.warning(f"failed to extract candidate preview frame: {candidate.id}")
        updated.append(candidate)
    return updated


def _extract_candidate_preview_frame(source_file: str, candidate: ClipCandidate, output_path: Path) -> None:
    timestamp = max(0.0, float(candidate.start or 0) + min(2.0, max(0.1, float(candidate.duration or 1) * 0.25)))
    command = [
        utils.get_ffmpeg_binary(),
        "-y",
        "-ss",
        f"{timestamp:.3f}",
        "-i",
        source_file,
        "-frames:v",
        "1",
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-q:v",
        "3",
        str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=20)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "FFmpeg falhou ao extrair frame.").strip()[-500:])


def read_output_subtitle(job_id: str, output_id: str) -> str:
    output = _find_output(job_id, output_id)
    subtitle_path = _safe_output_path(job_id, str(output.get("subtitle_path") or ""))
    if not subtitle_path.is_file():
        raise RuntimeError("Legenda do short nao encontrada.")
    return subtitle_path.read_text(encoding="utf-8")


def update_output_subtitle(
    job_id: str,
    output_id: str,
    subtitle_text: str,
    subtitle_style: str | None = None,
    subtitle_text_color: str | None = None,
    subtitle_border_color: str | None = None,
    subtitle_size: str | None = None,
    subtitle_position: str | None = None,
) -> dict:
    output = _find_output(job_id, output_id)
    subtitle_path = _safe_output_path(job_id, str(output.get("subtitle_path") or ""))
    video_path = _safe_output_path(job_id, str(output.get("video_path") or ""))
    if not video_path.name:
        raise RuntimeError("Video do short nao encontrado.")
    camera_path = video_path.with_suffix("").with_suffix(".camera.mp4")
    if not camera_path.is_file():
        camera_path = Path(str(video_path).replace(".mp4", ".camera.mp4"))
    _validate_srt_text(subtitle_text)
    _validate_srt_timing_sequence(subtitle_text)
    subtitle_style = normalize_subtitle_style(subtitle_style or str(output.get("subtitle_style") or "standard"))
    subtitle_text = _subtitle_text_for_saved_style(subtitle_text, subtitle_style)
    subtitle_path.write_text(subtitle_text.strip() + "\n", encoding="utf-8")
    subtitle_text_color = normalize_subtitle_color(subtitle_text_color or str(output.get("subtitle_text_color") or "white"), "white")
    subtitle_border_color = normalize_subtitle_color(
        subtitle_border_color or str(output.get("subtitle_border_color") or "black"),
        "black",
    )
    subtitle_size = normalize_subtitle_size(subtitle_size or str(output.get("subtitle_size") or "medium"))
    subtitle_position = normalize_subtitle_position(subtitle_position or str(output.get("subtitle_position") or "middle"))
    render_result = reburn_podcast_subtitles(
        camera_path=str(camera_path),
        subtitle_path=str(subtitle_path),
        output_path=str(video_path),
        burn_subtitles=bool(output.get("burn_subtitles", True)),
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        watermark_enabled=bool(output.get("watermark_enabled", True)),
    )
    output = _persist_output_assets(job_id, {
        **output,
        "duration": render_result.get("duration") or output.get("duration"),
        "subtitle_path": str(subtitle_path),
        "video_path": str(video_path),
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "subtitle_edited": True,
        "subtitle_edited_at": int(time.time()),
    })

    def apply(current):
        for index, item in enumerate(current.outputs):
            if str(item.get("id") or "") != output_id:
                continue
            current.outputs[index] = output
            break
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    job = registry.update_job(job_id, apply)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    return next((item for item in job.outputs if str(item.get("id") or "") == output_id), output)


def update_output_subtitle_mode(
    job_id: str,
    output_id: str,
    burn_subtitles: bool,
    subtitle_style: str | None = None,
    subtitle_text_color: str | None = None,
    subtitle_border_color: str | None = None,
    subtitle_size: str | None = None,
    subtitle_position: str | None = None,
) -> dict:
    output = _find_output(job_id, output_id)
    subtitle_path = _safe_output_path(job_id, str(output.get("subtitle_path") or ""))
    video_path = _safe_output_path(job_id, str(output.get("video_path") or ""))
    camera_path = video_path.with_suffix("").with_suffix(".camera.mp4")
    if not camera_path.is_file():
        camera_path = Path(str(video_path).replace(".mp4", ".camera.mp4"))
    subtitle_style = normalize_subtitle_style(subtitle_style or str(output.get("subtitle_style") or "standard"))
    if subtitle_style == "standard" and subtitle_path.is_file():
        subtitle_text = _subtitle_text_for_saved_style(subtitle_path.read_text(encoding="utf-8"), subtitle_style)
        subtitle_path.write_text(subtitle_text.strip() + "\n", encoding="utf-8")
    subtitle_text_color = normalize_subtitle_color(subtitle_text_color or str(output.get("subtitle_text_color") or "white"), "white")
    subtitle_border_color = normalize_subtitle_color(
        subtitle_border_color or str(output.get("subtitle_border_color") or "black"),
        "black",
    )
    subtitle_size = normalize_subtitle_size(subtitle_size or str(output.get("subtitle_size") or "medium"))
    subtitle_position = normalize_subtitle_position(subtitle_position or str(output.get("subtitle_position") or "middle"))
    render_result = reburn_podcast_subtitles(
        camera_path=str(camera_path),
        subtitle_path=str(subtitle_path),
        output_path=str(video_path),
        burn_subtitles=burn_subtitles,
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        watermark_enabled=bool(output.get("watermark_enabled", True)),
    )
    output = _persist_output_assets(job_id, {
        **output,
        "duration": render_result.get("duration") or output.get("duration"),
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "subtitle_edited_at": int(time.time()),
    })

    def apply(current):
        for index, item in enumerate(current.outputs):
            if str(item.get("id") or "") != output_id:
                continue
            current.outputs[index] = output
            break
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    job = registry.update_job(job_id, apply)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    return next((item for item in job.outputs if str(item.get("id") or "") == output_id), output)


def update_output_metadata(
    job_id: str,
    output_id: str,
    title: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    cover_title: str | None = None,
    cover_template: str | None = None,
    cover_text_position: str | None = None,
) -> dict:
    output = dict(_find_output(job_id, output_id))
    old_cover_title = str(output.get("cover_title") or output.get("title") or "").strip()
    old_cover_template = normalize_cover_template(output.get("cover_template"))
    old_cover_text_position = normalize_cover_text_position(output.get("cover_text_position"))
    if title is not None:
        output["title"] = _clean_text(title, 100)
    if description is not None:
        output["public_description"] = _clean_multiline_text(description, 5000)
    if tags is not None:
        output["youtube_tags"] = [_clean_text(tag, 60).lstrip("#") for tag in tags if _clean_text(tag, 60)]
    if cover_title is not None:
        output["cover_title"] = _clean_text(cover_title, 80)
    elif title is not None and not output.get("cover_title"):
        output["cover_title"] = _clean_text(title, 80)
    if cover_template is not None:
        output["cover_template"] = normalize_cover_template(cover_template)
    if cover_text_position is not None:
        output["cover_text_position"] = normalize_cover_text_position(cover_text_position)

    new_cover_title = str(output.get("cover_title") or output.get("title") or "").strip()
    new_cover_template = normalize_cover_template(output.get("cover_template"))
    new_cover_text_position = normalize_cover_text_position(output.get("cover_text_position"))
    should_update_covers = new_cover_title and (
        new_cover_title != old_cover_title
        or new_cover_template != old_cover_template
        or new_cover_text_position != old_cover_text_position
        or not output.get("cover_options")
    )
    if should_update_covers:
        try:
            attach_cover_options(job_dir(job_id), [output], variants=3)
            output = _persist_cover_assets(job_id, output)
            output["cover_updated_at"] = int(time.time())
        except Exception:
            logger.exception(f"failed to update podcast covers: job={job_id}, output={output_id}")
            raise RuntimeError("Não foi possível atualizar as capas.")

    output["metadata_edited_at"] = int(time.time())

    def apply(current):
        for index, item in enumerate(current.outputs):
            if str(item.get("id") or "") != output_id:
                continue
            current.outputs[index] = output
            break
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    job = registry.update_job(job_id, apply)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    return next((item for item in job.outputs if str(item.get("id") or "") == output_id), output)


def edit_output(
    job_id: str,
    output_id: str,
    trim_start: float,
    trim_end: float | None,
    recover_before: float = 0,
    recover_after: float = 0,
    append_output_id: str | None = None,
    append_position: str = "after",
    timeline_project: dict | None = None,
) -> dict:
    output = _find_output(job_id, output_id)
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    edited_output = edit_podcast_output(
        job_id=job_id,
        output=output,
        outputs=[dict(item) for item in job.outputs],
        trim_start=trim_start,
        trim_end=trim_end,
        recover_before=recover_before,
        recover_after=recover_after,
        append_output_id=append_output_id,
        append_position=append_position,
        timeline_project=timeline_project,
        source_file=job.source_file,
        transcript=job.transcript,
    )
    edited_output = _persist_output_assets(job_id, edited_output)

    def apply(current):
        current.outputs.append(edited_output)
        current.status = "done"
        current.current_step = "done"
        current.progress = 100
        current.estimated_remaining_seconds = None
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    updated_job = registry.update_job(job_id, apply)
    if not updated_job:
        raise RuntimeError("Podcast job nao encontrado.")
    return edited_output


def update_output_timeline(job_id: str, output_id: str, timeline_project: dict) -> dict:
    if not isinstance(timeline_project, dict):
        raise RuntimeError("Timeline invalida.")
    output = dict(_find_output(job_id, output_id))
    output["timeline_project"] = timeline_project
    output["timeline_updated_at"] = int(time.time())

    def apply(current):
        for index, item in enumerate(current.outputs):
            if str(item.get("id") or "") != output_id:
                continue
            current.outputs[index] = output
            break
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    job = registry.update_job(job_id, apply)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    return next((item for item in job.outputs if str(item.get("id") or "") == output_id), output)


def delete_output(job_id: str, output_id: str) -> dict:
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")

    output = None
    remaining_outputs = []
    for item in job.outputs:
        if str(item.get("id") or "") == output_id:
            output = dict(item)
        else:
            remaining_outputs.append(item)
    if output is None:
        raise RuntimeError("Short de podcast nao encontrado.")
    if not output.get("edited_from"):
        raise RuntimeError("Apenas clipes editados podem ser excluidos.")

    _delete_output_assets(job_id, output)

    def apply(current):
        current.outputs = remaining_outputs
        current.status = "done"
        current.current_step = "done"
        current.progress = 100
        current.estimated_remaining_seconds = None
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    updated_job = registry.update_job(job_id, apply)
    if not updated_job:
        raise RuntimeError("Podcast job nao encontrado.")
    return output


def _clean_text(value: str, limit: int) -> str:
    text = " ".join(str(value or "").strip().split())
    return text[:limit]


def _clean_multiline_text(value: str, limit: int) -> str:
    lines = [" ".join(line.strip().split()) for line in str(value or "").strip().splitlines()]
    text = "\n".join(line for line in lines if line)
    return text[:limit]


def _persist_output_assets(job_id: str, output: dict) -> dict:
    if not r2_storage.configured():
        return output
    updated = dict(output)
    output_id = str(updated.get("id") or utils.get_uuid()).replace("/", "-")
    base_key = f"podcast/{job_id}/outputs/{output_id}"

    video_path = Path(str(updated.get("video_path") or ""))
    if video_path.is_file():
        try:
            before_size = video_path.stat().st_size
            with tempfile.TemporaryDirectory(prefix=f"flixo-r2-{job_id}-{output_id}-") as temp_dir:
                upload_source = Path(temp_dir) / video_path.name
                shutil.copy2(video_path, upload_source)
                compressed_path = r2_storage.compress_mp4_for_storage(upload_source)
                after_size = compressed_path.stat().st_size
                key = f"{base_key}.mp4"
                uploaded = r2_storage.upload_file(compressed_path, key, "video/mp4")
            if uploaded:
                updated["video_key"] = key
                updated["video_url"] = r2_storage.public_url(key)
                updated["r2_video_key"] = key
                updated["r2_compressed"] = True
                updated["r2_original_size"] = before_size
                updated["r2_size"] = after_size
                updated["local_upload_quality"] = "original"
        except Exception:
            logger.exception(f"failed to persist podcast video to R2: job={job_id}, output={output_id}")

    subtitle_path = Path(str(updated.get("subtitle_path") or ""))
    if subtitle_path.is_file():
        try:
            key = f"{base_key}.srt"
            if r2_storage.upload_file(subtitle_path, key, "text/plain; charset=utf-8"):
                updated["subtitle_key"] = key
                updated["subtitle_url"] = r2_storage.public_url(key)
                updated["r2_subtitle_key"] = key
        except Exception:
            logger.exception(f"failed to persist podcast subtitle to R2: job={job_id}, output={output_id}")

    return _persist_cover_assets(job_id, updated)


def _persist_cover_assets(job_id: str, output: dict) -> dict:
    if not r2_storage.configured():
        return output
    updated = dict(output)
    output_id = str(updated.get("id") or utils.get_uuid()).replace("/", "-")
    base_key = f"podcast/{job_id}/outputs/{output_id}"
    cover_options = updated.get("cover_options")
    if isinstance(cover_options, list):
        updated_options = []
        for index, option in enumerate(cover_options, start=1):
            if not isinstance(option, dict):
                continue
            option_copy = dict(option)
            cover_path = Path(str(option_copy.get("path") or ""))
            if cover_path.is_file():
                try:
                    key = f"{base_key}-cover-{index}.jpg"
                    if r2_storage.upload_file(cover_path, key, "image/jpeg"):
                        option_copy["key"] = key
                        option_copy["url"] = r2_storage.public_url(key)
                except Exception:
                    logger.exception(f"failed to persist podcast cover to R2: job={job_id}, output={output_id}")
            frame_path = Path(str(option_copy.get("frame_path") or ""))
            if frame_path.is_file():
                try:
                    frame_key = f"{base_key}-cover-{index}-frame.jpg"
                    if r2_storage.upload_file(frame_path, frame_key, "image/jpeg"):
                        option_copy["frame_key"] = frame_key
                        option_copy["frame_url"] = r2_storage.public_url(frame_key)
                except Exception:
                    logger.exception(f"failed to persist podcast cover frame to R2: job={job_id}, output={output_id}")
            updated_options.append(option_copy)
        updated["cover_options"] = updated_options
        if updated_options:
            updated["cover_key"] = updated_options[0].get("key") or updated.get("cover_key")
            updated["cover_url"] = updated_options[0].get("url") or updated.get("cover_url")
    return updated


def _delete_output_assets(job_id: str, output: dict) -> None:
    r2_keys = _output_r2_keys(output)
    for key in sorted(key for key in r2_keys if key):
        if _safe_output_key(job_id, key):
            r2_storage.delete_file(key)

    for path in _output_local_paths(output):
        _delete_local_output_path(job_id, path)


def _output_r2_keys(output: dict) -> set[str]:
    keys = {
        str(output.get("video_key") or output.get("r2_video_key") or "").strip(),
        str(output.get("subtitle_key") or output.get("r2_subtitle_key") or "").strip(),
        str(output.get("cover_key") or "").strip(),
    }
    for option in output.get("cover_options") or []:
        if not isinstance(option, dict):
            continue
        keys.add(str(option.get("key") or "").strip())
        keys.add(str(option.get("frame_key") or "").strip())
    return {key for key in keys if key}


def _safe_output_key(job_id: str, key: str) -> bool:
    value = str(key or "").strip().lstrip("/")
    return value.startswith(f"podcast/{job_id}/outputs/") and ".." not in Path(value).parts


def _output_local_paths(output: dict) -> set[str]:
    paths = {
        str(output.get("video_path") or ""),
        str(output.get("subtitle_path") or ""),
    }
    video_path_value = str(output.get("video_path") or "")
    video_path = Path(video_path_value)
    if video_path_value:
        paths.add(str(video_path.with_suffix("").with_suffix(".camera.mp4")))
        paths.add(str(video_path).replace(".mp4", ".camera.mp4"))
    for option in output.get("cover_options") or []:
        if not isinstance(option, dict):
            continue
        paths.add(str(option.get("path") or ""))
        paths.add(str(option.get("frame_path") or ""))
    return {path for path in paths if path}


def _delete_local_output_path(job_id: str, path: str) -> None:
    try:
        base = Path(job_dir(job_id)).resolve()
        target = Path(path).resolve()
        if not target.is_relative_to(base):
            raise RuntimeError("Caminho fora do job de podcast.")
        if target.is_file():
            target.unlink(missing_ok=True)
    except RuntimeError:
        raise
    except Exception:
        logger.exception(f"failed to delete podcast output asset: job={job_id}, path={path}")


def _cleanup_source_video(job_id: str, source_file: str | None) -> None:
    if not source_file:
        return
    try:
        base = Path(job_dir(job_id)).resolve()
        target = Path(source_file).resolve()
        if not target.is_relative_to(base):
            return
        if target.is_file():
            target.unlink(missing_ok=True)
    except Exception:
        logger.exception(f"failed to clean podcast source video: {job_id}")


def _find_output(job_id: str, output_id: str) -> dict:
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    for output in job.outputs:
        if str(output.get("id") or "") == output_id:
            return dict(output)
    raise RuntimeError("Short de podcast nao encontrado.")


def restore_job_from_metadata(job_id: str) -> ClipperJob | None:
    metadata_path = Path(job_dir(job_id)) / "metadata.json"
    if not metadata_path.is_file():
        return None
    try:
        import json

        with metadata_path.open(encoding="utf-8") as file:
            data = json.load(file)
        job = clipper_job_from_dict(data)
        if not job.id:
            job.id = job_id
        job.metadata_path = str(metadata_path)
        return registry.set_job(job)
    except Exception:
        logger.exception(f"failed to restore podcast job metadata: {job_id}")
        return None


def _safe_output_path(job_id: str, path: str) -> Path:
    if not path:
        raise RuntimeError("Caminho do arquivo invalido.")
    base = Path(job_dir(job_id)).resolve()
    target = Path(path).resolve()
    if not target.is_relative_to(base):
        raise RuntimeError("Caminho fora do job de podcast.")
    return target


def _validate_srt_text(value: str) -> None:
    text = (value or "").strip()
    if not text:
        raise RuntimeError("A legenda nao pode ficar vazia.")
    if "-->" not in text:
        raise RuntimeError("Formato SRT invalido: timestamps ausentes.")


def _srt_timestamps(value: str) -> list[str]:
    return [
        line.strip()
        for line in (value or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if "-->" in line
    ]


def _srt_timestamp_ms(value: str) -> int:
    match = re.fullmatch(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})", value.strip())
    if not match:
        raise RuntimeError("Formato SRT invalido: timestamp mal formatado.")
    hours, minutes, seconds, milliseconds = match.groups()
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1_000
        + int(milliseconds.ljust(3, "0"))
    )


def _validate_srt_timing_sequence(value: str) -> None:
    previous_end = -1
    timestamps = _srt_timestamps(value)
    if not timestamps:
        raise RuntimeError("Formato SRT invalido: timestamps ausentes.")
    for line in timestamps:
        parts = [part.strip() for part in line.split("-->", 1)]
        if len(parts) != 2:
            raise RuntimeError("Formato SRT invalido: intervalo de tempo mal formatado.")
        start = _srt_timestamp_ms(parts[0])
        end = _srt_timestamp_ms(parts[1])
        if end <= start:
            raise RuntimeError("Formato SRT invalido: o fim da legenda precisa ser maior que o inicio.")
        if start < previous_end:
            raise RuntimeError("Formato SRT invalido: as legendas nao podem se sobrepor.")
        previous_end = end


def _subtitle_text_for_saved_style(subtitle_text: str, subtitle_style: str) -> str:
    if normalize_subtitle_style(subtitle_style) != "standard":
        return subtitle_text.strip()
    segments = _srt_text_to_segments(subtitle_text)
    if not segments:
        return subtitle_text.strip()
    merged = _merge_short_srt_segments(segments)
    compacted = compact_subtitle_segments(merged, max_chars=34, min_duration=0.9)
    lines = [
        utils.text_to_srt(index, segment.text, segment.start, segment.end).strip()
        for index, segment in enumerate(compacted, start=1)
    ]
    return "\n\n".join(lines).strip()


def _srt_text_to_segments(value: str) -> list[TranscriptSegment]:
    lines = (value or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    segments: list[TranscriptSegment] = []
    cursor = 0
    while cursor < len(lines):
        time_index = next((index for index in range(cursor, len(lines)) if "-->" in lines[index]), -1)
        if time_index < 0:
            break
        next_time_index = next((index for index in range(time_index + 1, len(lines)) if "-->" in lines[index]), -1)
        text_start = time_index + 1
        text_end = next_time_index
        if text_end > -1 and text_end - 1 >= text_start and lines[text_end - 1].strip().isdigit():
            text_end -= 1
        text_lines = [
            line.strip()
            for line in lines[text_start:(text_end if text_end > -1 else len(lines))]
            if line.strip()
        ]
        parts = [part.strip() for part in lines[time_index].split("-->", 1)]
        if len(parts) == 2:
            segments.append(
                TranscriptSegment(
                    start=round(_srt_timestamp_ms(parts[0]) / 1000, 3),
                    end=round(_srt_timestamp_ms(parts[1]) / 1000, 3),
                    text=" ".join(text_lines).strip(),
                )
            )
        cursor = next_time_index if next_time_index > -1 else len(lines)
    return [segment for segment in segments if segment.text]


def _merge_short_srt_segments(
    segments: list[TranscriptSegment],
    max_chars: int = 42,
    max_duration: float = 3.2,
    max_gap: float = 0.35,
) -> list[TranscriptSegment]:
    merged: list[TranscriptSegment] = []
    current: TranscriptSegment | None = None
    for segment in segments:
        text = " ".join(segment.text.split())
        if not text:
            continue
        if current is None:
            current = TranscriptSegment(segment.start, segment.end, text)
            continue
        gap = segment.start - current.end
        candidate_text = f"{current.text} {text}".strip()
        candidate_duration = segment.end - current.start
        previous_ends_sentence = bool(re.search(r"[.!?]$", current.text.strip()))
        should_flush = (
            gap > max_gap
            or len(candidate_text) > max_chars
            or candidate_duration > max_duration
            or previous_ends_sentence
        )
        if should_flush:
            merged.append(current)
            current = TranscriptSegment(segment.start, segment.end, text)
        else:
            current = TranscriptSegment(current.start, segment.end, candidate_text)
    if current is not None:
        merged.append(current)
    return merged


def _transcription_initial_eta(source_file: str | None) -> int:
    if not source_file or not os.path.isfile(source_file):
        return 180
    size_mb = os.path.getsize(source_file) / (1024 * 1024)
    # faster-whisper varies heavily by CPU/GPU. This is intentionally conservative.
    return int(max(90, min(900, size_mb * 1.4)))


def _probe_source_metadata(source_url: str | None) -> dict:
    if not source_url:
        return {}
    try:
        metadata = ytdlp_probe_metadata(source_url)
    except Exception:
        logger.warning("failed to probe youtube metadata for clipper context")
        return {}
    return _safe_source_metadata(metadata)


def _safe_source_metadata(metadata: dict) -> dict:
    tags = metadata.get("tags") if isinstance(metadata.get("tags"), list) else []
    categories = metadata.get("categories") if isinstance(metadata.get("categories"), list) else []
    return {
        "title": _clean_text(metadata.get("title") or "", 180),
        "channel": _clean_text(metadata.get("channel") or metadata.get("uploader") or "", 120),
        "uploader": _clean_text(metadata.get("uploader") or metadata.get("channel") or "", 120),
        "description": _clean_multiline_text(metadata.get("description") or "", 1200),
        "tags": [_clean_text(tag, 60).lstrip("#") for tag in tags[:40] if _clean_text(tag, 60)],
        "categories": [_clean_text(category, 80) for category in categories[:8] if _clean_text(category, 80)],
        "duration": metadata.get("duration") or 0,
        "filesize": metadata.get("filesize") or metadata.get("filesize_approx") or 0,
        "webpage_url": _clean_text(metadata.get("webpage_url") or "", 300),
    }


def _source_context(job: ClipperJob, source_metadata: dict | None = None) -> dict:
    metadata = source_metadata or job.source_metadata or {}
    context = dict(metadata) if isinstance(metadata, dict) else {}
    if job.original_name and not context.get("title"):
        context["title"] = job.original_name
    if job.source_url and not context.get("webpage_url"):
        context["webpage_url"] = job.source_url
    return context


def _initial_analysis_eta(source_url: str | None, source_file: str | None, source_metadata: dict | None = None) -> int:
    duration = 0.0
    file_size = 0
    if source_url and source_metadata:
        duration = float(source_metadata.get("duration") or 0)
        file_size = int(source_metadata.get("filesize") or 0)
    elif source_url:
        try:
            metadata = ytdlp_probe_metadata(source_url)
            duration = float(metadata.get("duration") or 0)
            file_size = int(metadata.get("filesize") or metadata.get("filesize_approx") or 0)
        except Exception:
            logger.warning("failed to probe youtube metadata for podcast ETA")
    elif source_file and os.path.isfile(source_file):
        duration = _probe_local_duration(source_file)
        file_size = os.path.getsize(source_file)

    if duration <= 0:
        return 12 * 60 if source_url else 6 * 60

    download_seconds = _estimate_download_seconds(file_size, duration)
    audio_seconds = max(15, duration * 0.035)
    transcription_seconds = max(90, duration * 0.45)
    analysis_seconds = max(35, min(180, duration * 0.035))
    safety_seconds = max(45, duration * 0.08)
    return int(download_seconds + audio_seconds + transcription_seconds + analysis_seconds + safety_seconds)


def _fallback_initial_eta(source_url: str | None) -> int:
    return 12 * 60 if source_url else 6 * 60


def _remaining_from_total(started_at: float, total_seconds: int, minimum: int = 15) -> int:
    elapsed = max(0, time.time() - float(started_at or time.time()))
    return int(max(minimum, total_seconds - elapsed))


def _estimate_download_seconds(file_size: int, duration: float) -> float:
    if file_size > 0:
        # Conservative local default: roughly 4 MB/s effective throughput.
        return max(30, min(20 * 60, file_size / (4 * 1024 * 1024)))
    # Metadata often omits file size. Duration-based fallback avoids showing tiny ETAs for long podcasts.
    return max(60, min(15 * 60, duration * 0.18))


def _probe_local_duration(source_file: str) -> float:
    import subprocess

    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            source_file,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def _eta_from_percent(started_at: float, percent: float, minimum_seconds: int = 5) -> int | None:
    if percent <= 0.02:
        return None
    elapsed = max(0.0, time.time() - float(started_at or time.time()))
    remaining = elapsed * (1 - percent) / percent
    return int(max(minimum_seconds, min(3600, remaining)))


def _update_render_eta(job_id: str, completed: int, total: int) -> None:
    if total <= 0:
        return
    percent = max(0.0, min(1.0, completed / total))

    def apply(current):
        if current.current_step != "rendering":
            return
        current.progress = max(current.progress, 15 + int(percent * 80))
        current.estimated_remaining_seconds = _eta_from_percent(
            current.step_started_at,
            percent,
            minimum_seconds=10,
        )

    registry.update_job(job_id, apply)
