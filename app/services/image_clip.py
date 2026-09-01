import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from threading import Lock
from typing import Any

from loguru import logger

from app.utils import utils


_jobs: dict[str, dict[str, Any]] = {}
_lock = Lock()

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"}
_TRANSITIONS = {"none", "fade", "slideleft", "slideright", "wipeleft", "wiperight"}


def create_job(
    job_id: str,
    *,
    user_id: str | None,
    audio_path: str,
    image_paths: list[str],
    aspect: str,
    transition: str,
) -> dict[str, Any]:
    job = {
        "id": job_id,
        "user_id": user_id,
        "title": "Clipe com imagens",
        "status": "queued",
        "current_step": "queued",
        "progress": 0,
        "error": None,
        "audio_path": audio_path,
        "image_paths": image_paths,
        "aspect": normalize_aspect(aspect),
        "transition": normalize_transition(transition),
        "duration": 0,
        "video_path": None,
        "video_url": None,
        "download_url": None,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    _set_job(job)
    return job


def replace_existing_user_jobs(user_id: str | None) -> list[str]:
    if not user_id:
        return []
    root = Path(utils.storage_dir("tasks")) / "image_clip"
    jobs: list[dict[str, Any]] = []
    if root.is_dir():
        for metadata_path in root.glob("*/metadata.json"):
            try:
                data = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("user_id") == user_id:
                jobs.append(data)

    deleted: list[str] = []
    for job in jobs:
        if is_active_job(job):
            continue
        job_id = str(job.get("id") or "")
        if delete_job(job_id, user_id=user_id):
            deleted.append(job_id)
    return deleted


def replaceable_user_jobs(user_id: str | None) -> list[dict[str, Any]]:
    if not user_id:
        return []
    jobs = [job for job in _user_jobs(user_id) if not is_active_job(job)]
    jobs.sort(key=lambda job: float(job.get("updated_at") or 0), reverse=True)
    return jobs


def list_user_jobs(user_id: str | None, limit: int = 1) -> list[dict[str, Any]]:
    if not user_id:
        return []
    jobs = _user_jobs(user_id)
    jobs.sort(key=lambda job: float(job.get("updated_at") or 0), reverse=True)
    return jobs[: max(1, min(int(limit or 1), 10))]


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
    if job:
        return job
    return _load_job(job_id)


def is_active_job(job: dict[str, Any] | None) -> bool:
    if not job:
        return False
    status = str(job.get("status") or "")
    step = str(job.get("current_step") or "")
    return status in {"queued", "running"} or step in {"queued", "preparing", "rendering"}


def active_job(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    jobs = _user_jobs(user_id)
    jobs.sort(key=lambda job: float(job.get("updated_at") or 0), reverse=True)
    return next((job for job in jobs if is_active_job(job)), None)


def delete_job(job_id: str, user_id: str | None = None) -> bool:
    if not job_id:
        return False
    job = get_job(job_id)
    if user_id and job and job.get("user_id") != user_id:
        return False
    task_path = Path(utils.storage_dir("tasks")) / "image_clip" / job_id
    tasks_root = Path(utils.storage_dir("tasks")) / "image_clip"
    try:
        resolved_task = task_path.resolve()
        resolved_root = tasks_root.resolve()
        if resolved_task == resolved_root or resolved_root not in resolved_task.parents:
            return False
        if resolved_task.exists():
            shutil.rmtree(resolved_task)
        with _lock:
            _jobs.pop(job_id, None)
        return True
    except OSError:
        logger.exception(f"failed to delete image clip job: {job_id}")
        return False


def render_job(job_id: str) -> None:
    job = get_job(job_id)
    if not job:
        return
    try:
        _update_job(job_id, status="running", current_step="preparing", progress=10)
        audio_path = str(job.get("audio_path") or "")
        image_paths = [str(path) for path in job.get("image_paths") or []]
        if not os.path.isfile(audio_path):
            raise RuntimeError("Arquivo de áudio não encontrado.")
        if not image_paths or any(not os.path.isfile(path) for path in image_paths):
            raise RuntimeError("Uma ou mais imagens não foram encontradas.")

        audio_duration = _probe_duration(audio_path)
        if audio_duration <= 0:
            raise RuntimeError("Não foi possível identificar a duração do áudio.")
        duration = audio_duration
        if duration < 1:
            raise RuntimeError("O áudio precisa ter pelo menos 1 segundo.")

        _update_job(job_id, current_step="rendering", progress=35, duration=round(duration, 3))
        output_path = os.path.join(job_dir(job_id), "final.mp4")
        _render_slideshow(
            audio_path=audio_path,
            image_paths=image_paths,
            output_path=output_path,
            aspect=str(job.get("aspect") or "vertical"),
            transition=str(job.get("transition") or "none"),
            duration=duration,
        )
        final_duration = _probe_duration(output_path) or duration
        _update_job(
            job_id,
            status="done",
            current_step="done",
            progress=100,
            duration=round(final_duration, 3),
            video_path=output_path,
            video_url=_task_url(output_path),
            download_url=_task_url(output_path),
            error=None,
        )
    except Exception as exc:
        logger.exception(f"image clip render failed: {job_id}")
        _update_job(
            job_id,
            status="failed",
            current_step="failed",
            progress=100,
            error=str(exc),
        )


def job_dir(job_id: str) -> str:
    path = utils.task_dir(os.path.join("image_clip", job_id))
    os.makedirs(path, exist_ok=True)
    return path


def normalize_aspect(value: str | None) -> str:
    value = str(value or "vertical").strip().lower()
    return value if value in {"vertical", "square", "landscape"} else "vertical"


def normalize_transition(value: str | None) -> str:
    value = str(value or "none").strip().lower()
    return value if value in _TRANSITIONS else "none"


def validate_image_filename(filename: str) -> str:
    return _sanitize_filename(filename, _IMAGE_EXTENSIONS, "imagem")


def validate_audio_filename(filename: str) -> str:
    return _sanitize_filename(filename, _AUDIO_EXTENSIONS, "áudio")


def _sanitize_filename(filename: str, allowed: set[str], label: str) -> str:
    name = (filename or "").replace("\\", "/").split("/")[-1].strip()
    suffix = Path(name).suffix.lower()
    if not name or name in {".", ".."} or suffix not in allowed:
        raise ValueError(f"Arquivo de {label} inválido.")
    return name


def _set_job(job: dict[str, Any]) -> dict[str, Any]:
    job.pop("max_duration", None)
    job["updated_at"] = time.time()
    with _lock:
        _jobs[str(job["id"])] = job
    _save_job(job)
    return job


def _update_job(job_id: str, **updates) -> dict[str, Any] | None:
    job = get_job(job_id)
    if not job:
        return None
    job.update(updates)
    return _set_job(job)


def _metadata_path(job_id: str, create: bool = False) -> str:
    if create:
        base = job_dir(job_id)
    else:
        base = os.path.join(utils.storage_dir("tasks"), "image_clip", job_id)
    return os.path.join(base, "metadata.json")


def _save_job(job: dict[str, Any]) -> None:
    path = _metadata_path(str(job["id"]), create=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(job, file, ensure_ascii=False, indent=2)


def _load_job(job_id: str) -> dict[str, Any] | None:
    path = _metadata_path(job_id)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as file:
        job = json.load(file)
    if isinstance(job, dict) and job.get("id"):
        with _lock:
            _jobs[job_id] = job
        return job
    return None


def _user_jobs(user_id: str) -> list[dict[str, Any]]:
    root = Path(utils.storage_dir("tasks")) / "image_clip"
    jobs: list[dict[str, Any]] = []
    with _lock:
        jobs.extend(job for job in _jobs.values() if job.get("user_id") == user_id)
    if root.is_dir():
        for metadata_path in root.glob("*/metadata.json"):
            try:
                data = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("user_id") == user_id:
                jobs.append(data)
    deduped: dict[str, dict[str, Any]] = {}
    for job in jobs:
        job_id = str(job.get("id") or "")
        if job_id:
            deduped[job_id] = job
    return list(deduped.values())


def _render_slideshow(
    *,
    audio_path: str,
    image_paths: list[str],
    output_path: str,
    aspect: str,
    transition: str,
    duration: float,
) -> None:
    width, height = _target_size(aspect)
    transition = normalize_transition(transition)
    if transition == "none" or len(image_paths) < 2 or duration / len(image_paths) < 0.75:
        _render_slideshow_concat(
            audio_path=audio_path,
            image_paths=image_paths,
            output_path=output_path,
            width=width,
            height=height,
            duration=duration,
        )
        return

    _render_slideshow_xfade(
        audio_path=audio_path,
        image_paths=image_paths,
        output_path=output_path,
        width=width,
        height=height,
        duration=duration,
        transition=transition,
    )


def _render_slideshow_concat(
    *,
    audio_path: str,
    image_paths: list[str],
    output_path: str,
    width: int,
    height: int,
    duration: float,
) -> None:
    per_image = max(0.5, duration / len(image_paths))
    command = [utils.get_ffmpeg_binary(), "-y"]
    for image_path in image_paths:
        command.extend(["-loop", "1", "-t", f"{per_image:.3f}", "-i", image_path])
    audio_index = len(image_paths)
    command.extend(["-i", audio_path])

    filters = []
    labels = []
    for index, _image_path in enumerate(image_paths):
        label = f"v{index}"
        labels.append(f"[{label}]")
        filters.append(
            f"[{index}:v]"
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1,fps=30,format=yuv420p"
            f"[{label}]"
        )
    filters.append(f"{''.join(labels)}concat=n={len(image_paths)}:v=1:a=0[v]")

    command.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[v]",
            "-map",
            f"{audio_index}:a:0",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            os.getenv("IMAGE_CLIP_CRF", "20"),
            "-c:a",
            "aac",
            "-b:a",
            os.getenv("IMAGE_CLIP_AUDIO_BITRATE", "160k"),
            "-movflags",
            "+faststart",
            "-shortest",
            output_path,
        ]
    )
    _run(command, "Falha ao montar o clipe com imagens.")


def _render_slideshow_xfade(
    *,
    audio_path: str,
    image_paths: list[str],
    output_path: str,
    width: int,
    height: int,
    duration: float,
    transition: str,
) -> None:
    transition_duration = min(0.7, max(0.2, duration / (len(image_paths) * 8)))
    segment_duration = (duration + transition_duration * (len(image_paths) - 1)) / len(image_paths)
    if segment_duration <= transition_duration + 0.05:
        _render_slideshow_concat(
            audio_path=audio_path,
            image_paths=image_paths,
            output_path=output_path,
            width=width,
            height=height,
            duration=duration,
        )
        return

    command = [utils.get_ffmpeg_binary(), "-y"]
    for image_path in image_paths:
        command.extend(["-loop", "1", "-t", f"{segment_duration:.3f}", "-i", image_path])
    audio_index = len(image_paths)
    command.extend(["-i", audio_path])

    filters = []
    for index, _image_path in enumerate(image_paths):
        filters.append(
            f"[{index}:v]"
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1,fps=30,format=yuv420p"
            f"[v{index}]"
        )

    previous_label = "v0"
    for index in range(1, len(image_paths)):
        output_label = "vxf" if index == len(image_paths) - 1 else f"vx{index}"
        offset = max(0.01, index * (segment_duration - transition_duration))
        filters.append(
            f"[{previous_label}][v{index}]"
            f"xfade=transition={transition}:duration={transition_duration:.3f}:offset={offset:.3f}"
            f"[{output_label}]"
        )
        previous_label = output_label

    command.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[vxf]",
            "-map",
            f"{audio_index}:a:0",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            os.getenv("IMAGE_CLIP_CRF", "20"),
            "-c:a",
            "aac",
            "-b:a",
            os.getenv("IMAGE_CLIP_AUDIO_BITRATE", "160k"),
            "-movflags",
            "+faststart",
            "-shortest",
            output_path,
        ]
    )
    _run(command, "Falha ao aplicar transições entre imagens.")


def _target_size(aspect: str) -> tuple[int, int]:
    if aspect == "landscape":
        return 1920, 1080
    if aspect == "square":
        return 1080, 1080
    return 1080, 1920


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
        return round(float(result.stdout.strip()), 3)
    except (TypeError, ValueError):
        return 0.0


def _run(command: list[str], message: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{message} {detail[-900:]}")


def _task_url(path: str) -> str:
    normalized = os.path.abspath(path).replace("\\", "/")
    marker = "/storage/tasks/"
    if marker in normalized:
        return "/tasks/" + normalized.split(marker, 1)[1]
    return path


def copy_upload(source, target_path: str) -> None:
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    with open(target_path, "wb") as target:
        shutil.copyfileobj(source, target)
