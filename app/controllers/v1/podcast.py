import os
import shutil
from typing import Annotated

from fastapi import BackgroundTasks, Form, Header, Query, UploadFile
from fastapi.params import File
from pydantic import BaseModel, Field

from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services.podcast import registry
from app.services.podcast.ingest import job_dir
from app.services.podcast.pipeline import (
    analyze_job,
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


class PodcastOutputEditRequest(BaseModel):
    trim_start: float = Field(default=0, ge=0)
    trim_end: float = Field(gt=0)
    append_output_id: str | None = None
    append_position: str = Field(default="after", pattern="^(before|after)$")


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
        )
    except RuntimeError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"output": output})


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
