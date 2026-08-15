import json
import os
from typing import Any

from app.services.clipper.models import ClipperJob


def write_job_metadata(job: ClipperJob, output_dir: str) -> str:
    path = os.path.join(output_dir, "metadata.json")
    with open(path, "w", encoding="utf-8") as file:
        json.dump(job.to_dict(include_transcript=True), file, ensure_ascii=False, indent=2)
    return path
