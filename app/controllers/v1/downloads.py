from fastapi import BackgroundTasks
from pydantic import BaseModel, Field

from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services import youtube_downloader
from app.utils import utils

router = new_router()


class YouTubeDownloadRequest(BaseModel):
    url: str
    max_height: int = Field(default=720, ge=144, le=2160)


@router.post("/downloads/youtube", summary="Download a YouTube video locally")
def create_youtube_download(body: YouTubeDownloadRequest, background_tasks: BackgroundTasks):
    try:
        job = youtube_downloader.create_download(body.url, body.max_height)
    except RuntimeError as exc:
        raise HttpException(task_id="", status_code=400, message=str(exc))
    background_tasks.add_task(youtube_downloader.download_job, job["id"])
    return utils.get_response(200, {"job": job})


@router.get("/downloads/youtube/{job_id}", summary="Get YouTube download status")
def get_youtube_download(job_id: str):
    job = youtube_downloader.get_download(job_id)
    if not job:
        raise HttpException(task_id=job_id, status_code=404, message="Download nao encontrado.")
    return utils.get_response(200, {"job": job})
