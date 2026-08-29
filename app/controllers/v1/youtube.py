from fastapi import BackgroundTasks, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services import youtube_uploader
from app.utils import utils

router = new_router()


class YouTubeUploadRequest(BaseModel):
    job_id: str
    output_id: str
    title: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    privacy_status: str = Field(default="private", pattern="^(private|unlisted|public)$")
    publish_at: str | None = None
    video_language: str = "pt-BR"
    audio_language: str = "pt-BR"
    category_id: str = Field(default="", pattern="^$|^[0-9]+$")


class YouTubeJobUploadRequest(BaseModel):
    job_id: str
    overrides: dict[str, dict[str, str | list[str] | None]] = Field(default_factory=dict)
    privacy_status: str = Field(default="private", pattern="^(private|unlisted|public)$")
    cleanup_after_upload: bool = True
    archive_after_upload: bool = True
    video_language: str = "pt-BR"
    audio_language: str = "pt-BR"
    category_id: str = Field(default="", pattern="^$|^[0-9]+$")


@router.get("/youtube/oauth/status", summary="Get YouTube OAuth status")
def youtube_oauth_status():
    return utils.get_response(200, youtube_uploader.oauth_status())


@router.get("/youtube/channels", summary="List authorized YouTube channels")
def youtube_channels():
    try:
        channels = youtube_uploader.list_authorized_channels()
    except RuntimeError as exc:
        raise HttpException(task_id="", status_code=400, message=str(exc))
    return utils.get_response(200, {"channels": channels})


@router.get("/youtube/i18n-options", summary="List YouTube languages and regions")
def youtube_i18n_options():
    try:
        options = youtube_uploader.list_i18n_options()
    except RuntimeError as exc:
        raise HttpException(task_id="", status_code=400, message=str(exc))
    return utils.get_response(200, options)


@router.get("/youtube/oauth/start", summary="Start YouTube OAuth flow")
def youtube_oauth_start(frontend_url: str | None = Query(default=None)):
    try:
        return utils.get_response(200, {"authorization_url": youtube_uploader.authorization_url(frontend_url)})
    except RuntimeError as exc:
        raise HttpException(task_id="", status_code=400, message=str(exc))


@router.get("/youtube/oauth/callback", summary="Handle YouTube OAuth callback")
def youtube_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    if error:
        raise HttpException(task_id="", status_code=400, message=f"OAuth recusado: {error}")
    if not code or not state:
        raise HttpException(task_id="", status_code=400, message="Callback OAuth incompleto.")
    try:
        frontend_url = youtube_uploader.handle_oauth_callback(code, state)
    except RuntimeError as exc:
        raise HttpException(task_id="", status_code=400, message=str(exc))
    separator = "&" if "?" in frontend_url else "?"
    return RedirectResponse(f"{frontend_url}{separator}youtube=connected")


@router.post("/youtube/upload", summary="Upload a rendered short to YouTube")
def youtube_upload(body: YouTubeUploadRequest):
    try:
        result = youtube_uploader.upload_clipper_output(
            job_id=body.job_id,
            output_id=body.output_id,
            title=body.title,
            description=body.description,
            tags=body.tags,
            privacy_status=body.privacy_status,
            publish_at=body.publish_at,
            video_language=body.video_language,
            audio_language=body.audio_language,
            category_id=body.category_id,
        )
    except RuntimeError as exc:
        raise HttpException(task_id=body.job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"upload": result})


@router.post("/youtube/upload-job", summary="Upload all rendered shorts and clean local job")
def youtube_upload_job(body: YouTubeJobUploadRequest):
    try:
        result = youtube_uploader.upload_clipper_job(
            job_id=body.job_id,
            overrides=body.overrides,
            privacy_status=body.privacy_status,
            cleanup_after_upload=body.cleanup_after_upload,
            video_language=body.video_language,
            audio_language=body.audio_language,
            category_id=body.category_id,
        )
    except RuntimeError as exc:
        raise HttpException(task_id=body.job_id, status_code=400, message=str(exc))
    return utils.get_response(200, result)


@router.post("/youtube/upload-podcast", summary="Upload a rendered podcast short to YouTube")
def youtube_upload_podcast(body: YouTubeUploadRequest):
    try:
        result = youtube_uploader.upload_podcast_output(
            job_id=body.job_id,
            output_id=body.output_id,
            title=body.title,
            description=body.description,
            tags=body.tags,
            privacy_status=body.privacy_status,
            publish_at=body.publish_at,
            video_language=body.video_language,
            audio_language=body.audio_language,
            category_id=body.category_id,
        )
    except RuntimeError as exc:
        raise HttpException(task_id=body.job_id, status_code=400, message=str(exc))
    return utils.get_response(200, {"upload": result})


@router.post("/youtube/upload-podcast-job", summary="Upload all rendered podcast shorts and clean local job")
def youtube_upload_podcast_job(body: YouTubeJobUploadRequest, background_tasks: BackgroundTasks):
    try:
        result = youtube_uploader.upload_podcast_job(
            job_id=body.job_id,
            overrides=body.overrides,
            privacy_status=body.privacy_status,
            cleanup_after_upload=body.cleanup_after_upload,
            video_language=body.video_language,
            audio_language=body.audio_language,
            category_id=body.category_id,
        )
        if body.archive_after_upload:
            background_tasks.add_task(youtube_uploader.compress_podcast_job_for_history, body.job_id)
            result["archive"] = {"compression_scheduled": True}
    except RuntimeError as exc:
        raise HttpException(task_id=body.job_id, status_code=400, message=str(exc))
    return utils.get_response(200, result)
