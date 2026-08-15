import os

from app.utils import utils


def job_dir(job_id: str) -> str:
    path = utils.task_dir(os.path.join("podcast", job_id))
    os.makedirs(path, exist_ok=True)
    return path
