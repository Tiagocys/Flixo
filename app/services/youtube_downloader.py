import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from loguru import logger

from app.utils import utils
from app.services.ytdlp_runner import (
    ytdlp_command_base,
    ytdlp_common_args,
    ytdlp_error_detail,
    ytdlp_public_error_message,
)

_jobs: dict[str, dict] = {}


def create_download(url: str, max_height: int = 720) -> dict:
    if not _is_youtube_url(url):
        raise RuntimeError("Informe uma URL valida do YouTube.")
    job_id = utils.get_uuid()
    output_dir = Path(utils.task_dir(os.path.join("downloads", job_id)))
    output_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "id": job_id,
        "status": "running",
        "progress": 10,
        "url": url,
        "error": None,
        "video_path": None,
        "video_url": None,
        "title": "",
        "max_height": max_height,
    }
    _jobs[job_id] = job
    return job


def get_download(job_id: str) -> dict | None:
    return _jobs.get(job_id)


def download_job(job_id: str) -> None:
    job = _jobs.get(job_id)
    if not job:
        return
    try:
        output_dir = Path(utils.task_dir(os.path.join("downloads", job_id)))
        output_path = _download_youtube(job["url"], output_dir, int(job.get("max_height") or 720))
        job["status"] = "done"
        job["progress"] = 100
        job["video_path"] = str(output_path)
        job["video_url"] = _task_url(str(output_path))
        job["title"] = output_path.stem
    except Exception as exc:
        job["status"] = "failed"
        job["progress"] = 100
        job["error"] = str(exc)


def _download_youtube(url: str, output_dir: Path, max_height: int) -> Path:
    height = max(144, min(max_height, 2160))
    output_template = str(output_dir / "%(title).180B [%(id)s].%(ext)s")
    format_selectors = [
        f"bv*[ext=mp4][height<={height}]+ba[ext=m4a]/b[ext=mp4][height<={height}]/best[height<={height}]/best",
        f"b[ext=mp4][height<={min(height, 480)}]/18/best[height<={min(height, 480)}]/best",
        "18/b[ext=mp4]/best",
    ]
    last_result = None
    for selector in format_selectors:
        _clean_partial_downloads(output_dir)
        command = [
            *ytdlp_command_base(),
            *ytdlp_common_args(),
            "--no-playlist",
            "--restrict-filenames",
            "--merge-output-format",
            "mp4",
            "-f",
            selector,
            "-o",
            output_template,
            url,
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0:
            break
        last_result = result
    else:
        detail = ytdlp_error_detail(last_result.stderr if last_result else "", last_result.stdout if last_result else "")
        logger.warning(f"yt-dlp download failed for {url}: {detail}")
        raise RuntimeError(ytdlp_public_error_message())

    candidates = sorted(
        [
            path
            for path in output_dir.iterdir()
            if path.is_file() and path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}
        ],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("yt-dlp concluiu, mas nenhum arquivo de video foi encontrado.")
    return candidates[0]


def _clean_partial_downloads(output_dir: Path) -> None:
    if not output_dir.is_dir():
        return
    for path in output_dir.iterdir():
        if path.is_file() and (
            path.name.endswith(".part")
            or ".f" in path.name and path.suffix.lower() in {".part", ".ytdl"}
            or path.suffix.lower() in {".ytdl", ".temp", ".tmp"}
        ):
            path.unlink(missing_ok=True)


def _is_youtube_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return any(domain in host for domain in ("youtube.com", "youtu.be"))


def _task_url(path: str) -> str:
    normalized = path.replace("\\", "/")
    marker = "/storage/tasks/"
    if marker not in normalized:
        return normalized
    return "/tasks/" + normalized.split(marker, 1)[1]
