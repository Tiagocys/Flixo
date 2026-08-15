import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

import requests

from app.services.youtube_downloader import _download_youtube
from app.utils import utils


def job_dir(job_id: str) -> str:
    path = utils.task_dir(os.path.join("clipper", job_id))
    os.makedirs(path, exist_ok=True)
    return path


def is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(domain in host for domain in ("youtube.com", "youtu.be"))


def download_direct_url(url: str, output_dir: str) -> str:
    parsed = urlparse(url)
    ext = os.path.splitext(parsed.path)[1].lower()
    if ext not in {".mp4", ".mov", ".mkv", ".webm"}:
        ext = ".mp4"
    output = os.path.join(output_dir, f"source{ext}")
    with requests.get(url, stream=True, timeout=60) as response:
        response.raise_for_status()
        with open(output, "wb") as file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    file.write(chunk)
    return output


def download_youtube_url(url: str, output_dir: str) -> str:
    cached = _cached_youtube_download(url)
    if cached:
        target = Path(output_dir) / f"source{cached.suffix.lower() or '.mp4'}"
        shutil.copy2(cached, target)
        return str(target)

    return str(_download_youtube(url, Path(output_dir), 720))


def ingest_url(url: str, output_dir: str) -> str:
    return download_youtube_url(url, output_dir) if is_youtube_url(url) else download_direct_url(url, output_dir)


def _cached_youtube_download(url: str) -> Path | None:
    video_id = _youtube_video_id(url)
    if not video_id:
        return None

    downloads_root = Path(utils.task_dir("downloads"))
    if not downloads_root.is_dir():
        return None

    matches = sorted(
        [
            path
            for path in downloads_root.glob("**/*")
            if path.is_file()
            and path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}
            and f"[{video_id}]" in path.name
        ],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return matches[0] if matches else None


def _youtube_video_id(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if "youtu.be" in host:
        return parsed.path.strip("/").split("/", 1)[0]
    if "youtube.com" in host:
        match = re.search(r"(?:^|&)v=([^&]+)", parsed.query)
        if match:
            return match.group(1)
        shorts_match = re.search(r"/(?:shorts|embed)/([^/?#]+)", parsed.path)
        if shorts_match:
            return shorts_match.group(1)
    return ""
