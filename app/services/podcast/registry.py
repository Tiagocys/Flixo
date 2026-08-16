import json
import os
from threading import Lock
import time
from typing import Callable

from app.services import clipper_database
from app.services.clipper.models import ClipperJob, clipper_job_from_dict
from app.utils import utils

_jobs: dict[str, ClipperJob] = {}
_lock = Lock()
STALE_JOB_MESSAGE = "Processo interrompido antes de concluir. Inicie uma nova analise para este video."


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


def delete_job(job_id: str) -> None:
    with _lock:
        _jobs.pop(job_id, None)


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
