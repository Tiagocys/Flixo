import os
import time
from pathlib import Path

from loguru import logger

from app.services.clipper.analyzer import analyze_transcript
from app.services.clipper.ingest import ingest_url
from app.services.clipper.metadata import write_job_metadata
from app.services.clipper.models import ClipCandidate, ClipperJob, clipper_job_from_dict
from app.services.clipper.transcriber import transcribe_video
from app.services.podcast import registry
from app.services.podcast.covers import attach_cover_options
from app.services.podcast.editor import edit_podcast_output
from app.services.podcast.ingest import job_dir
from app.services.podcast.renderer import reburn_podcast_subtitles, render_podcast_clip
from app.services.ytdlp_runner import ytdlp_probe_metadata


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
        initial_eta = _initial_analysis_eta(source_url, job.source_file)
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
        candidates = analyze_transcript(transcript, max_candidates=10, min_duration=18, max_duration=90)
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
) -> None:
    try:
        job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
        if not job or not job.source_file:
            raise RuntimeError("Job de podcast nao encontrado ou sem video de origem.")
        if not selected_ids:
            raise RuntimeError("Selecione pelo menos um corte.")
        _raise_if_cancelled(job_id)

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

        def done(current):
            current.outputs = outputs
            current.status = "done"
            current.current_step = "done"
            current.progress = 100
            current.estimated_remaining_seconds = None
            current.metadata_path = write_job_metadata(current, output_dir)

        registry.update_job(job_id, done)
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
    return {
        "id": candidate.id,
        "title": candidate.title,
        "score": candidate.scores.get("overall", 0),
        "start": candidate.start,
        "end": candidate.end,
        "duration": render_result.get("duration") or candidate.duration,
        "source_duration": candidate.duration,
        "removed_silence_seconds": render_result.get("removed_silence_seconds", 0),
        "burn_subtitles": bool(render_result.get("burn_subtitles", True)),
        "hook": candidate.hook,
        "summary": candidate.summary,
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


def read_output_subtitle(job_id: str, output_id: str) -> str:
    output = _find_output(job_id, output_id)
    subtitle_path = _safe_output_path(job_id, str(output.get("subtitle_path") or ""))
    if not subtitle_path.is_file():
        raise RuntimeError("Legenda do short nao encontrada.")
    return subtitle_path.read_text(encoding="utf-8")


def update_output_subtitle(job_id: str, output_id: str, subtitle_text: str) -> dict:
    output = _find_output(job_id, output_id)
    subtitle_path = _safe_output_path(job_id, str(output.get("subtitle_path") or ""))
    video_path = _safe_output_path(job_id, str(output.get("video_path") or ""))
    if not video_path.name:
        raise RuntimeError("Video do short nao encontrado.")
    camera_path = video_path.with_suffix("").with_suffix(".camera.mp4")
    if not camera_path.is_file():
        camera_path = Path(str(video_path).replace(".mp4", ".camera.mp4"))
    _validate_srt_text(subtitle_text)
    subtitle_path.write_text(subtitle_text.strip() + "\n", encoding="utf-8")
    render_result = reburn_podcast_subtitles(
        camera_path=str(camera_path),
        subtitle_path=str(subtitle_path),
        output_path=str(video_path),
        burn_subtitles=bool(output.get("burn_subtitles", True)),
    )

    def apply(current):
        for index, item in enumerate(current.outputs):
            if str(item.get("id") or "") != output_id:
                continue
            updated = dict(item)
            updated["duration"] = render_result.get("duration") or updated.get("duration")
            updated["subtitle_path"] = str(subtitle_path)
            updated["video_path"] = str(video_path)
            updated["subtitle_url"] = _task_url(str(subtitle_path))
            updated["video_url"] = _task_url(str(video_path))
            updated["subtitle_edited"] = True
            updated["subtitle_edited_at"] = int(time.time())
            current.outputs[index] = updated
            break
        current.metadata_path = write_job_metadata(current, job_dir(job_id))

    job = registry.update_job(job_id, apply)
    if not job:
        raise RuntimeError("Podcast job nao encontrado.")
    return next((item for item in job.outputs if str(item.get("id") or "") == output_id), output)


def update_output_subtitle_mode(job_id: str, output_id: str, burn_subtitles: bool) -> dict:
    output = _find_output(job_id, output_id)
    subtitle_path = _safe_output_path(job_id, str(output.get("subtitle_path") or ""))
    video_path = _safe_output_path(job_id, str(output.get("video_path") or ""))
    camera_path = video_path.with_suffix("").with_suffix(".camera.mp4")
    if not camera_path.is_file():
        camera_path = Path(str(video_path).replace(".mp4", ".camera.mp4"))
    render_result = reburn_podcast_subtitles(
        camera_path=str(camera_path),
        subtitle_path=str(subtitle_path),
        output_path=str(video_path),
        burn_subtitles=burn_subtitles,
    )

    def apply(current):
        for index, item in enumerate(current.outputs):
            if str(item.get("id") or "") != output_id:
                continue
            updated = dict(item)
            updated["duration"] = render_result.get("duration") or updated.get("duration")
            updated["burn_subtitles"] = burn_subtitles
            updated["subtitle_edited_at"] = int(time.time())
            current.outputs[index] = updated
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
    trim_end: float,
    append_output_id: str | None = None,
    append_position: str = "after",
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
        append_output_id=append_output_id,
        append_position=append_position,
    )

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


def _transcription_initial_eta(source_file: str | None) -> int:
    if not source_file or not os.path.isfile(source_file):
        return 180
    size_mb = os.path.getsize(source_file) / (1024 * 1024)
    # faster-whisper varies heavily by CPU/GPU. This is intentionally conservative.
    return int(max(90, min(900, size_mb * 1.4)))


def _initial_analysis_eta(source_url: str | None, source_file: str | None) -> int:
    duration = 0.0
    file_size = 0
    if source_url:
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
