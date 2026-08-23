import os
from datetime import datetime, timezone
from typing import Any

import requests
from loguru import logger

from app.services.clipper.models import ClipperJob, clipper_job_from_dict

_table_missing = False


def configured() -> bool:
    return bool(not _table_missing and _base_url() and _service_role_key())


def upsert_job(job: ClipperJob) -> None:
    if not configured():
        return
    row = _job_to_row(job)
    response = _request(
        "POST",
        _table_name(),
        params={"on_conflict": "id"},
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        json=[row],
    )
    if response is None:
        return
    if response.ok:
        return
    if _is_missing_table(response):
        _disable_missing_table()
        return
    logger.warning(
        "failed to persist clipper job to Supabase: "
        f"job={job.id}, status={response.status_code}, body={response.text[:300]}"
    )


def get_job(job_id: str, user_id: str | None = None) -> ClipperJob | None:
    if not configured():
        return None
    params = {
        "id": f"eq.{job_id}",
        "select": "data",
        "limit": "1",
    }
    if user_id:
        params["user_id"] = f"eq.{user_id}"
    response = _request("GET", _table_name(), params=params)
    if response is None:
        return None
    if not response.ok:
        if _is_missing_table(response):
            _disable_missing_table()
        return None
    rows = response.json() if response.text else []
    if not rows:
        return None
    data = rows[0].get("data") if isinstance(rows[0], dict) else None
    if not isinstance(data, dict):
        return None
    job = clipper_job_from_dict(data)
    return job if job.id else None


def delete_job(job_id: str, user_id: str | None = None) -> bool:
    if not configured():
        return True
    params = {"id": f"eq.{job_id}"}
    if user_id:
        params["user_id"] = f"eq.{user_id}"
    response = _request(
        "DELETE",
        _table_name(),
        params=params,
        headers={"Prefer": "return=minimal"},
    )
    if response is None:
        return False
    if response.ok:
        return True
    if _is_missing_table(response):
        _disable_missing_table()
        return True
    logger.warning(
        "failed to delete clipper job from Supabase: "
        f"job={job_id}, status={response.status_code}, body={response.text[:300]}"
    )
    return False


def list_jobs(limit: int = 10, user_id: str | None = None) -> list[ClipperJob]:
    if not configured():
        return []
    params = {
        "select": "data",
        "order": "updated_at.desc",
        "limit": str(limit),
    }
    if user_id:
        params["user_id"] = f"eq.{user_id}"
    response = _request("GET", _table_name(), params=params)
    if response is None:
        return []
    if not response.ok:
        if _is_missing_table(response):
            _disable_missing_table()
            return []
        logger.warning(
            "failed to list clipper jobs from Supabase: "
            f"status={response.status_code}, body={response.text[:300]}"
        )
        return []
    rows = response.json() if response.text else []
    jobs: list[ClipperJob] = []
    for row in rows:
        data = row.get("data") if isinstance(row, dict) else None
        if not isinstance(data, dict):
            continue
        job = clipper_job_from_dict(data)
        if job.id:
            jobs.append(job)
    return jobs


def _job_to_row(job: ClipperJob) -> dict[str, Any]:
    data = job.to_dict(include_transcript=True)
    outputs = job.outputs or []
    return {
        "id": job.id,
        "user_id": job.user_id,
        "status": job.status,
        "current_step": job.current_step,
        "progress": int(job.progress or 0),
        "title": _job_title(job),
        "source_url": job.source_url,
        "original_name": job.original_name,
        "candidates_count": len(job.candidates or []),
        "outputs_count": len(outputs),
        "r2_outputs_count": sum(1 for output in outputs if output.get("video_key") or output.get("r2_video_key")),
        "data": data,
        "created_at": _timestamp(job.created_at),
        "updated_at": _timestamp(job.updated_at),
    }


def _job_title(job: ClipperJob) -> str:
    for output in job.outputs or []:
        title = str(output.get("title") or "").strip()
        if title:
            return title
    if job.original_name:
        return job.original_name
    if job.source_url:
        return job.source_url
    return "Projeto de clipes"


def _timestamp(value: float | int | None) -> str:
    try:
        numeric = float(value or 0)
    except (TypeError, ValueError):
        numeric = 0
    if numeric <= 0:
        numeric = datetime.now(timezone.utc).timestamp()
    return datetime.fromtimestamp(numeric, timezone.utc).isoformat()


def _base_url() -> str:
    return str(os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_PROJECT_URL") or "").rstrip("/")


def _service_role_key() -> str:
    return str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "")


def _schema() -> str:
    return str(os.getenv("SUPABASE_SCHEMA") or "public")


def _table_name() -> str:
    return str(os.getenv("CLIPPER_PROJECTS_TABLE") or "clipper_projects")


def _headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    key = _service_role_key()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept-Profile": _schema(),
        "Content-Profile": _schema(),
    }
    if extra:
        headers.update(extra)
    return headers


def _request(
    method: str,
    path: str,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    json: Any = None,
) -> requests.Response | None:
    try:
        return requests.request(
            method,
            f"{_base_url()}/rest/v1/{path.lstrip('/')}",
            params=params,
            headers=_headers(headers),
            json=json,
            timeout=20,
        )
    except Exception:
        logger.exception("failed to call Supabase clipper database")
        return None


def _is_missing_table(response: requests.Response) -> bool:
    return response.status_code == 404 and "PGRST205" in response.text


def _disable_missing_table() -> None:
    global _table_missing
    if not _table_missing:
        logger.warning(
            "Supabase table 'clipper_projects' was not found. "
            "Run cloudflare/supabase/schema.sql to enable persistent Clipper history."
        )
    _table_missing = True
