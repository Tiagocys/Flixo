"""Application configuration - root APIRouter.

Defines all FastAPI application endpoints.

Resources:
    1. https://fastapi.tiangolo.com/tutorial/bigger-applications

"""

from fastapi import APIRouter

from app.controllers.v1 import clipper, downloads, image_clip, llm, podcast, video, youtube

root_api_router = APIRouter()
# v1
root_api_router.include_router(video.router)
root_api_router.include_router(llm.router)
root_api_router.include_router(downloads.router)
root_api_router.include_router(clipper.router)
root_api_router.include_router(podcast.router)
root_api_router.include_router(image_clip.router)
root_api_router.include_router(youtube.router)
