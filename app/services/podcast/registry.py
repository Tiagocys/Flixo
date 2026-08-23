import json
import os
import shutil
from pathlib import Path
from threading import Lock
from threading import Event
from threading import Thread
import time
from typing import Callable

from loguru import logger

from app.services import clipper_database, r2_storage
from app.services.clipper.models import ClipperJob, clipper_job_from_dict
from app.utils import utils

_jobs: dict[str, ClipperJob] = {}
_lock = Lock()
_retention_stop = Event()
_retention_thread: Thread | None = None
STALE_JOB_MESSAGE = "Processo interrompido antes de concluir. Inicie uma nova analise para este video."
TERMINAL_STATUSES = {"done", "failed", "cancelled"}
ACTIVE_STATUSES = {"queued", "running", "rendering"}
ACTIVE_STEPS = {"queued", "ingesting", "transcribing", "analyzing", "rendering"}


class JobDeleteNotFoundError(Exception):
    pass


class JobDeleteActiveError(Exception):
    pass


class JobDeleteCleanupError(Exception):
    pass


def create_job(job_id: str, **kwargs) -> ClipperJob:
    job = ClipperJob(id=job_id, **kwargs)
    with _lock:
        _jobs[job_id] = job
        _save_job(job)
    return job


def set_job(job: ClipperJob) -> ClipperJob:
    with _lock:
        _jobs[job.id] = job
        _save_job(job)
    return job


def get_job(job_id: str) -> ClipperJob | None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            return job
        job = _load_job(job_id)
        if not job:
            job = clipper_database.get_job(job_id)
        if job:
            _jobs[job_id] = job
        return job


def list_jobs(limit: int = 10, user_id: str | None = None) -> list[ClipperJob]:
    purge_expired_jobs()
    with _lock:
        _load_disk_jobs()
        jobs = list(_jobs.values())
        db_jobs = clipper_database.list_jobs(limit, user_id=user_id)
        for db_job in db_jobs:
            _jobs[db_job.id] = db_job
        jobs = list(_jobs.values())
    if user_id:
        jobs = [job for job in jobs if job.user_id == user_id]
    jobs.sort(key=lambda job: _job_sort_time(job), reverse=True)
    return jobs[:limit]


def update_job(job_id: str, updater: Callable[[ClipperJob], None]) -> ClipperJob | None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        updater(job)
        job.updated_at = time.time()
        _save_job(job)
        return job


def delete_job(job_id: str, user_id: str | None = None) -> bool:
    if not clipper_database.delete_job(job_id, user_id=user_id):
        return False
    with _lock:
        _jobs.pop(job_id, None)
    return True


def delete_job_with_assets(job_id: str, user_id: str | None) -> str:
    job = get_job(job_id)
    if not job or not user_id or not job.user_id or job.user_id != user_id:
        raise JobDeleteNotFoundError(job_id)
    if job.status in ACTIVE_STATUSES or job.current_step in ACTIVE_STEPS:
        raise JobDeleteActiveError(job_id)

    try:
        _delete_job_assets(job)
        if not delete_job(job.id, user_id=user_id):
            raise RuntimeError("failed to delete podcast project record")
    except Exception as exc:
        logger.exception(f"failed to delete podcast job: {job.id}")
        raise JobDeleteCleanupError(job.id) from exc
    return job.id


def purge_expired_jobs() -> int:
    retention_seconds = _history_retention_seconds()
    if retention_seconds <= 0:
        return 0
    cutoff = time.time() - retention_seconds
    expired: list[ClipperJob] = []
    with _lock:
        _load_disk_jobs()
        for job in list(_jobs.values()):
            if job.status not in TERMINAL_STATUSES:
                continue
            if _job_sort_time(job) <= cutoff:
                expired.append(job)

    deleted = 0
    for job in expired:
        try:
            _delete_job_assets(job)
            if not delete_job(job.id):
                raise RuntimeError("failed to delete expired podcast project record")
            deleted += 1
        except Exception:
            logger.exception(f"failed to purge expired podcast job: {job.id}")
    return deleted


def start_retention_worker() -> None:
    global _retention_thread
    if _retention_thread and _retention_thread.is_alive():
        return
    _retention_stop.clear()

    def run() -> None:
        purge_expired_jobs()
        interval = max(300, int(os.getenv("CLIPPER_HISTORY_CLEANUP_INTERVAL_SECONDS", "3600")))
        while not _retention_stop.wait(interval):
            purge_expired_jobs()

    _retention_thread = Thread(target=run, name="clipper-history-retention", daemon=True)
    _retention_thread.start()


def stop_retention_worker() -> None:
    _retention_stop.set()


def _history_retention_seconds() -> int:
    value = os.getenv("CLIPPER_HISTORY_RETENTION_SECONDS", "172800")
    try:
        return int(value)
    except (TypeError, ValueError):
        return 172800


def _delete_job_assets(job: ClipperJob) -> None:
    for key in _r2_keys_for_job(job):
        if not r2_storage.delete_file(key):
            raise RuntimeError(f"failed to delete R2 object: {key}")
    task_path = Path(utils.task_dir(os.path.join("podcast", job.id))).resolve()
    tasks_root = Path(utils.task_dir("podcast")).resolve()
    if task_path == tasks_root or tasks_root not in task_path.parents:
        raise RuntimeError("invalid podcast project cleanup path")
    if task_path.exists():
        if not task_path.is_dir():
            raise RuntimeError("podcast project cleanup path is not a directory")
        shutil.rmtree(task_path)


def _r2_keys_for_job(job: ClipperJob) -> set[str]:
    keys: set[str] = set()
    for output in job.outputs or []:
        for field in ("video_key", "r2_video_key", "subtitle_key", "r2_subtitle_key", "cover_key"):
            _add_r2_key(keys, output.get(field))
        for option in output.get("cover_options") or []:
            if not isinstance(option, dict):
                continue
            for field in ("key", "cover_key", "frame_key"):
                _add_r2_key(keys, option.get(field))
    return keys


def _add_r2_key(keys: set[str], value: object) -> None:
    key = str(value or "").strip().lstrip("/")
    if key and not key.startswith("http") and ".." not in key:
        keys.add(key)


def set_failed(job_id: str, error: str) -> None:
    def apply(job: ClipperJob):
        job.status = "failed"
        job.current_step = "failed"
        job.error = error
        job.estimated_remaining_seconds = None

    update_job(job_id, apply)


def cancel_job(job_id: str, reason: str = "Processo interrompido pelo usuario.") -> ClipperJob | None:
    def apply(job: ClipperJob):
        job.status = "cancelled"
        job.current_step = "cancelled"
        job.error = reason
        job.estimated_remaining_seconds = None

    return update_job(job_id, apply)


def is_cancelled(job_id: str) -> bool:
    job = get_job(job_id)
    return bool(job and job.status == "cancelled")


def _metadata_path(job_id: str) -> str:
    return os.path.join(utils.task_dir(os.path.join("podcast", job_id)), "metadata.json")


def _save_job(job: ClipperJob) -> None:
    path = _metadata_path(job.id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    job.metadata_path = path
    with open(path, "w", encoding="utf-8") as file:
        json.dump(job.to_dict(include_transcript=True), file, ensure_ascii=False, indent=2)
    clipper_database.upsert_job(job)


def _load_job(job_id: str) -> ClipperJob | None:
    path = _metadata_path(job_id)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as file:
        data = json.load(file)
    job = clipper_job_from_dict(data)
    if not job.id:
        job.id = job_id
    job.metadata_path = path
    if job.status in {"queued", "running", "rendering"}:
        job.status = "cancelled"
        job.current_step = "cancelled"
        job.error = STALE_JOB_MESSAGE
        job.progress = min(job.progress or 0, 99)
        job.estimated_remaining_seconds = None
        _save_job(job)
    return job


def _load_disk_jobs() -> None:
    root = utils.task_dir("podcast")
    if not os.path.isdir(root):
        return
    for name in os.listdir(root):
        if name in _jobs:
            continue
        metadata = os.path.join(root, name, "metadata.json")
        if not os.path.isfile(metadata):
            continue
        job = _load_job(name)
        if job:
            _jobs[name] = job


def _job_sort_time(job: ClipperJob) -> float:
    if job.metadata_path and os.path.isfile(job.metadata_path):
        return os.path.getmtime(job.metadata_path)
    if job.source_file and os.path.isfile(job.source_file):
        return os.path.getmtime(job.source_file)
    return job.updated_at or 0.0
