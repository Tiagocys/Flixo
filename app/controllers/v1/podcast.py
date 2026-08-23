import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, Form, Header, Query, UploadFile
from fastapi.params import File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services import r2_storage
from app.services.podcast import registry
from app.services.podcast.ingest import job_dir
from app.services.podcast.pipeline import (
    analyze_job,
    delete_output,
    edit_output,
    read_output_subtitle,
    render_job,
    restore_job_from_metadata,
    update_output_metadata,
    update_output_subtitle,
    update_output_subtitle_mode,
)
from app.utils import utils

router = new_router()


class PodcastRenderRequest(BaseModel):
    selected_ids: list[str] = Field(default_factory=list)
    burn_subtitles: bool = True
    remove_silence: bool = True
    artificial_cuts: bool = True


class PodcastSubtitleUpdateRequest(BaseModel):
    subtitle: str = Field(min_length=1)


class PodcastSubtitleModeRequest(BaseModel):
    burn_subtitles: bool = True


class PodcastOutputMetadataRequest(BaseModel):
    title: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    tags: list[str] = Field(default_factory=list)
    cover_title: str | None = Field(default=None, max_length=80)
    cover_template: str | None = Field(default=None, max_length=32)
    cover_text_position: str | None = Field(default=None, max_length=16)


class PodcastOutputEditRequest(BaseModel):
    trim_start: float = Field(default=0, ge=0)
    trim_end: float = Field(gt=0)
    append_output_id: str | None = None
    append_position: str = Field(default="after", pattern="^(before|after)$")


class PodcastCoverDownloadItem(BaseModel):
    output_id: str
    cover_key: str | None = None
    cover_url: str | None = None
    filename: str | None = None


class PodcastCoverDownloadRequest(BaseModel):
    covers: list[PodcastCoverDownloadItem] = Field(default_factory=list)


def _ensure_owner(job, user_id: str | None):
    if user_id and job.user_id and job.user_id != user_id:
        raise HttpException(task_id=job.id, status_code=404, message="Podcast job nao encontrado.")


def _job_title(job) -> str:
    for output in job.outputs or []:
        title = str(output.get("title") or "").strip()
        if title:
            return title
    if job.original_name:
        return job.original_name
    if job.source_url:
        return job.source_url
    return "Projeto de clipes"


def _public_response(job_id: str, include_transcript: bool = False, user_id: str | None = None):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, user_id)
    return utils.get_response(200, {"job": job.to_dict(include_transcript=include_transcript)})


@router.get("/podcast/jobs", summary="List podcast jobs from local storage")
def list_podcast_jobs(
    limit: int = Query(default=10, ge=1, le=50),
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    jobs = [
        {
            "id": job.id,
            "status": job.status,
            "current_step": job.current_step,
            "progress": job.progress,
            "outputs_count": len(job.outputs or []),
            "title": _job_title(job),
            "source_url": job.source_url,
            "r2_outputs_count": sum(1 for output in job.outputs or [] if output.get("video_key") or output.get("r2_video_key")),
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }
        for job in registry.list_jobs(limit, user_id=x_flixo_user_id)
    ]
    return utils.get_response(200, {"jobs": jobs})


@router.post("/podcast/jobs", summary="Analyze podcast video and suggest shorts")
async def create_podcast_job(
    background_tasks: BackgroundTasks,
    url: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job_id = utils.get_uuid()
    output_dir = job_dir(job_id)
    source_file = None
    original_name = None

    if file and file.filename:
        original_name = file.filename
        ext = os.path.splitext(original_name)[1].lower() or ".mp4"
        if ext not in {".mp4", ".mov", ".mkv", ".webm"}:
            raise HttpException(task_id=job_id, status_code=400, message="Formato de video nao suportado.")
        source_file = os.path.join(output_dir, f"upload{ext}")
        with open(source_file, "wb") as target:
            shutil.copyfileobj(file.file, target)
    elif not url:
        raise HttpException(task_id=job_id, status_code=400, message="Envie um arquivo de video ou uma URL.")

    job = registry.create_job(
        job_id,
        source_url=url,
        source_file=source_file,
        original_name=original_name,
        user_id=x_flixo_user_id,
    )
    background_tasks.add_task(analyze_job, job_id, url)
    return utils.get_response(200, {"job": job.to_dict()})


@router.get("/podcast/jobs/{job_id}", summary="Get podcast job status")
def get_podcast_job(
    job_id: str,
    include_transcript: bool = False,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    return _public_response(job_id, include_transcript=include_transcript, user_id=x_flixo_user_id)


@router.delete("/podcast/jobs/{job_id}", summary="Delete a podcast project and its assets")
def delete_podcast_job(
    job_id: str,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    try:
        deleted_id = registry.delete_job_with_assets(job_id, x_flixo_user_id)
    except registry.JobDeleteNotFoundError:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    except registry.JobDeleteActiveError:
        raise HttpException(
            task_id=job_id,
            status_code=409,
            message="Este projeto ainda esta sendo processado e nao pode ser excluido.",
        )
    except registry.JobDeleteCleanupError:
        raise HttpException(
            task_id=job_id,
            status_code=500,
            message="Nao foi possivel excluir o projeto agora. Tente novamente em instantes.",
        )
    return utils.get_response(200, {"deleted_id": deleted_id})


@router.post("/podcast/jobs/{job_id}/cancel", summary="Cancel a running podcast job")
def cancel_podcast_job(
    job_id: str,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    cancelled = registry.cancel_job(job_id)
    if not cancelled:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    return utils.get_response(200, {"job": cancelled.to_dict()})


@router.post("/podcast/jobs/{job_id}/render", summary="Render selected podcast shorts")
def render_podcast_job(
    job_id: str,
    body: PodcastRenderRequest,
    background_tasks: BackgroundTasks,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    if job.status not in {"ready", "done"}:
        raise HttpException(task_id=job_id, status_code=409, message="A analise ainda nao esta pronta.")
    if not body.selected_ids:
        raise HttpException(task_id=job_id, status_code=400, message="Selecione pelo menos um corte.")

    background_tasks.add_task(
        render_job,
        job_id,
        body.selected_ids,
        body.burn_subtitles,
        body.remove_silence,
        body.artificial_cuts,
    )
    return _public_response(job_id, user_id=x_flixo_user_id)


@router.get("/podcast/jobs/{job_id}/outputs/{output_id}/subtitle", summary="Read rendered podcast subtitle")
def get_podcast_output_subtitle(
    job_id: str,
    output_id: str,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    try:
        subtitle = read_output_subtitle(job_id, output_id)
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"subtitle": subtitle})


@router.put("/podcast/jobs/{job_id}/outputs/{output_id}/subtitle", summary="Update rendered podcast subtitle")
def update_podcast_output_subtitle(
    job_id: str,
    output_id: str,
    body: PodcastSubtitleUpdateRequest,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    try:
        output = update_output_subtitle(job_id, output_id, body.subtitle)
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"output": output})


@router.put("/podcast/jobs/{job_id}/outputs/{output_id}/subtitle-mode", summary="Toggle embedded subtitles")
def update_podcast_output_subtitle_mode(
    job_id: str,
    output_id: str,
    body: PodcastSubtitleModeRequest,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    try:
        output = update_output_subtitle_mode(job_id, output_id, body.burn_subtitles)
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"output": output})


@router.put("/podcast/jobs/{job_id}/outputs/{output_id}/metadata", summary="Update rendered podcast metadata")
def update_podcast_output_metadata(
    job_id: str,
    output_id: str,
    body: PodcastOutputMetadataRequest,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    try:
        output = update_output_metadata(
            job_id=job_id,
            output_id=output_id,
            title=body.title,
            description=body.description,
            tags=body.tags,
            cover_title=body.cover_title,
            cover_template=body.cover_template,
            cover_text_position=body.cover_text_position,
        )
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"output": output})


@router.post("/podcast/jobs/{job_id}/covers/download", summary="Download selected podcast covers as zip")
def download_podcast_covers(
    job_id: str,
    body: PodcastCoverDownloadRequest,
    background_tasks: BackgroundTasks,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)

    covers = body.covers or [
        PodcastCoverDownloadItem(output_id=str(output.get("id") or ""))
        for output in job.outputs
        if output.get("id")
    ]
    if not covers:
        raise HttpException(task_id=job_id, status_code=400, message="Nenhuma miniatura selecionada.")

    temp_dir = Path(tempfile.mkdtemp(prefix="flixo-covers-"))
    zip_path = temp_dir / f"miniaturas-{job_id}.zip"
    outputs_by_id = {str(output.get("id") or ""): output for output in job.outputs or []}
    added = 0

    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, cover in enumerate(covers, start=1):
                output = outputs_by_id.get(str(cover.output_id or ""))
                if not output:
                    continue
                path = _resolve_cover_file(job_id, output, cover, temp_dir)
                if not path or not path.is_file():
                    continue
                filename = _safe_cover_filename(cover.filename, output, index)
                archive.write(path, filename)
                added += 1
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HttpException(task_id=job_id, status_code=400, message=f"Falha ao preparar miniaturas: {exc}")

    if not added:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HttpException(task_id=job_id, status_code=404, message="Nenhuma miniatura encontrada.")

    background_tasks.add_task(shutil.rmtree, temp_dir, True)
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"miniaturas-{job_id}.zip",
    )


def _resolve_cover_file(
    job_id: str,
    output: dict,
    cover: PodcastCoverDownloadItem,
    temp_dir: Path,
) -> Path | None:
    path = _local_cover_file(job_id, output, cover)
    if path:
        return path

    key = _safe_cover_key(job_id, cover.cover_key or str(output.get("cover_key") or ""))
    if not key:
        return None
    target = temp_dir / f"{Path(key).stem}.jpg"
    return target if r2_storage.download_to_file(key, target) else None


def _local_cover_file(job_id: str, output: dict, cover: PodcastCoverDownloadItem) -> Path | None:
    base = Path(job_dir(job_id)).resolve()
    candidates: list[str] = []
    for option in output.get("cover_options") or []:
        if not isinstance(option, dict):
            continue
        key_matches = cover.cover_key and cover.cover_key == option.get("key")
        url_matches = cover.cover_url and cover.cover_url == option.get("url")
        if key_matches or url_matches:
            candidates.append(str(option.get("path") or ""))
    candidates.append(str(output.get("cover_path") or ""))

    for value in candidates:
        if not value:
            continue
        path = Path(value).resolve()
        if path.is_file() and base in path.parents:
            return path
    return None


def _safe_cover_key(job_id: str, key: str | None) -> str | None:
    value = str(key or "").strip().lstrip("/")
    prefix = f"podcast/{job_id}/outputs/"
    if not value.startswith(prefix) or ".." in Path(value).parts:
        return None
    return value


def _safe_cover_filename(value: str | None, output: dict, index: int) -> str:
    fallback = str(output.get("cover_title") or output.get("title") or output.get("id") or f"miniatura-{index}")
    name = str(value or fallback).strip().lower()
    normalized = "".join(char if char.isalnum() else "-" for char in name)
    normalized = "-".join(part for part in normalized.split("-") if part)
    return f"{str(index).zfill(2)}-{normalized or f'miniatura-{index}'}.jpg"


@router.post("/podcast/jobs/{job_id}/outputs/{output_id}/edit", summary="Create an edited podcast short")
def edit_podcast_output_endpoint(
    job_id: str,
    output_id: str,
    body: PodcastOutputEditRequest,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    try:
        output = edit_output(
            job_id=job_id,
            output_id=output_id,
            trim_start=body.trim_start,
            trim_end=body.trim_end,
            append_output_id=body.append_output_id,
            append_position=body.append_position,
        )
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"output": output})


@router.delete("/podcast/jobs/{job_id}/outputs/{output_id}", summary="Delete an edited podcast short")
def delete_podcast_output_endpoint(
    job_id: str,
    output_id: str,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id) or restore_job_from_metadata(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Podcast job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    try:
        output = delete_output(job_id, output_id)
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"deleted_output_id": str(output.get("id") or output_id)})
