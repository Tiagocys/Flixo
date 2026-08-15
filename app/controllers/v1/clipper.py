import os
import shutil
from typing import Annotated

from fastapi import BackgroundTasks, Form, Header, UploadFile
from fastapi.params import File
from pydantic import BaseModel, Field

from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services.clipper import registry
from app.services.clipper.ingest import job_dir
from app.services.clipper.pipeline import analyze_job, render_job
from app.utils import utils

router = new_router()


class ClipperRenderRequest(BaseModel):
    selected_ids: list[str] = Field(default_factory=list)
    burn_subtitles: bool = True


def _ensure_owner(job, user_id: str | None):
    if user_id and job.user_id and job.user_id != user_id:
        raise HttpException(task_id=job.id, status_code=404, message="Clipper job nao encontrado.")


def _public_response(job_id: str, include_transcript: bool = False, user_id: str | None = None):
    job = registry.get_job(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Clipper job nao encontrado.")
    _ensure_owner(job, user_id)
    return utils.get_response(200, {"job": job.to_dict(include_transcript=include_transcript)})


@router.get("/clipper/jobs", summary="List recent clipper jobs")
def list_clipper_jobs(
    limit: int = 10,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    jobs = registry.list_jobs(limit=max(1, min(limit, 30)), user_id=x_flixo_user_id)
    return utils.get_response(200, {"jobs": [job.to_dict() for job in jobs]})


@router.post("/clipper/jobs", summary="Analyze a long video and suggest short clips")
async def create_clipper_job(
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


@router.get("/clipper/jobs/{job_id}", summary="Get clipper job status")
def get_clipper_job(
    job_id: str,
    include_transcript: bool = False,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    return _public_response(job_id, include_transcript=include_transcript, user_id=x_flixo_user_id)


@router.post("/clipper/jobs/{job_id}/render", summary="Render selected semantic clips")
def render_clipper_job(
    job_id: str,
    body: ClipperRenderRequest,
    background_tasks: BackgroundTasks,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = registry.get_job(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Clipper job nao encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    if job.status not in {"ready", "done"}:
        raise HttpException(task_id=job_id, status_code=409, message="A analise ainda nao esta pronta.")
    if not body.selected_ids:
        raise HttpException(task_id=job_id, status_code=400, message="Selecione pelo menos um corte.")

    background_tasks.add_task(render_job, job_id, body.selected_ids, body.burn_subtitles)
    return _public_response(job_id, user_id=x_flixo_user_id)
