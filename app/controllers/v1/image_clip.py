import os
from typing import Annotated

from fastapi import BackgroundTasks, Form, Header, Query, UploadFile
from fastapi.params import File

from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services import image_clip
from app.utils import utils

router = new_router()


def _ensure_owner(job: dict, user_id: str | None) -> None:
    if user_id and job.get("user_id") and job.get("user_id") != user_id:
        raise HttpException(task_id=str(job.get("id") or ""), status_code=404, message="Projeto não encontrado.")


@router.post("/image-clip/jobs", summary="Create a video clip from uploaded audio and images")
async def create_image_clip_job(
    background_tasks: BackgroundTasks,
    audio: Annotated[UploadFile, File()],
    images: Annotated[list[UploadFile], File()],
    aspect: Annotated[str, Form()] = "vertical",
    transition: Annotated[str, Form()] = "none",
    replace_existing: Annotated[bool, Form()] = False,
    max_duration: Annotated[float | None, Form()] = None,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job_id = utils.get_uuid()
    if not images:
        raise HttpException(task_id=job_id, status_code=400, message="Envie pelo menos uma imagem.")
    if len(images) > 20:
        raise HttpException(task_id=job_id, status_code=400, message="Envie no máximo 20 imagens por clipe.")
    active_job = image_clip.active_job(x_flixo_user_id)
    if active_job:
        raise HttpException(
            task_id=job_id,
            status_code=409,
            message="Você já tem um clipe sendo renderizado. Aguarde terminar antes de criar outro.",
        )

    replaceable_jobs = image_clip.replaceable_user_jobs(x_flixo_user_id)
    if replaceable_jobs and not replace_existing:
        previous = replaceable_jobs[0]
        raise HttpException(
            task_id=job_id,
            status_code=409,
            message="O novo clipe substituirá o clipe anterior. Deseja continuar?",
            data={
                "requires_replacement_confirmation": True,
                "previous_job_id": previous.get("id"),
                "previous_duration": previous.get("duration"),
            },
        )
    if replace_existing:
        image_clip.replace_existing_user_jobs(x_flixo_user_id)

    output_dir = image_clip.job_dir(job_id)
    try:
        audio_name = image_clip.validate_audio_filename(audio.filename or "")
        audio_ext = os.path.splitext(audio_name)[1].lower()
        audio_path = os.path.join(output_dir, "audio", f"audio{audio_ext}")
        image_clip.copy_upload(audio.file, audio_path)

        image_paths: list[str] = []
        for index, upload in enumerate(images, start=1):
            image_name = image_clip.validate_image_filename(upload.filename or "")
            image_ext = os.path.splitext(image_name)[1].lower()
            image_path = os.path.join(output_dir, "images", f"image-{index:03d}{image_ext}")
            image_clip.copy_upload(upload.file, image_path)
            image_paths.append(image_path)
    except ValueError as exc:
        raise HttpException(task_id=job_id, status_code=400, message=str(exc))

    job = image_clip.create_job(
        job_id,
        user_id=x_flixo_user_id,
        audio_path=audio_path,
        image_paths=image_paths,
        aspect=aspect,
        transition=transition,
    )
    background_tasks.add_task(image_clip.render_job, job_id)
    return utils.get_response(200, {"job": _public_job(job)})


@router.get("/image-clip/jobs", summary="List current image clip jobs")
def list_image_clip_jobs(
    limit: int = Query(default=1, ge=1, le=10),
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    jobs = image_clip.list_user_jobs(x_flixo_user_id, limit=limit)
    return utils.get_response(200, {"jobs": [_public_job(job) for job in jobs]})


@router.get("/image-clip/jobs/{job_id}", summary="Get image clip render status")
def get_image_clip_job(
    job_id: str,
    x_flixo_user_id: Annotated[str | None, Header(alias="X-Flixo-User-Id")] = None,
):
    job = image_clip.get_job(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Projeto não encontrado.")
    _ensure_owner(job, x_flixo_user_id)
    return utils.get_response(200, {"job": _public_job(job)})


def _public_job(job: dict) -> dict:
    data = dict(job)
    data.pop("audio_path", None)
    data.pop("image_paths", None)
    data.pop("video_path", None)
    data.pop("user_id", None)
    data.pop("max_duration", None)
    return data
