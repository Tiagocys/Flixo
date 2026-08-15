import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str

    def to_dict(self) -> dict[str, Any]:
        return {"start": self.start, "end": self.end, "text": self.text}


@dataclass
class ClipCandidate:
    id: str
    start: float
    end: float
    duration: float
    title: str
    hook: str
    summary: str
    reason: str
    scores: dict[str, int]
    visual_focus: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "start": self.start,
            "end": self.end,
            "duration": self.duration,
            "title": self.title,
            "hook": self.hook,
            "summary": self.summary,
            "reason": self.reason,
            "scores": self.scores,
            "visual_focus": self.visual_focus,
        }


@dataclass
class ClipperJob:
    id: str
    status: str = "queued"
    progress: int = 0
    current_step: str = "queued"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    step_started_at: float = field(default_factory=time.time)
    estimated_remaining_seconds: int | None = None
    source_url: str | None = None
    source_file: str | None = None
    original_name: str | None = None
    user_id: str | None = None
    error: str | None = None
    transcript: list[TranscriptSegment] = field(default_factory=list)
    candidates: list[ClipCandidate] = field(default_factory=list)
    outputs: list[dict[str, Any]] = field(default_factory=list)
    metadata_path: str | None = None

    def to_dict(self, include_transcript: bool = False) -> dict[str, Any]:
        data = {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "current_step": self.current_step,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "step_started_at": self.step_started_at,
            "estimated_remaining_seconds": self.estimated_remaining_seconds,
            "source_url": self.source_url,
            "source_file": self.source_file,
            "original_name": self.original_name,
            "user_id": self.user_id,
            "error": self.error,
            "candidates": [candidate.to_dict() for candidate in self.candidates],
            "outputs": self.outputs,
            "metadata_path": self.metadata_path,
        }
        if include_transcript:
            data["transcript"] = [segment.to_dict() for segment in self.transcript]
        return data


def transcript_segment_from_dict(data: dict[str, Any]) -> TranscriptSegment:
    return TranscriptSegment(
        start=float(data.get("start") or 0),
        end=float(data.get("end") or 0),
        text=str(data.get("text") or ""),
    )


def clip_candidate_from_dict(data: dict[str, Any]) -> ClipCandidate:
    return ClipCandidate(
        id=str(data.get("id") or ""),
        start=float(data.get("start") or 0),
        end=float(data.get("end") or 0),
        duration=float(data.get("duration") or 0),
        title=str(data.get("title") or ""),
        hook=str(data.get("hook") or ""),
        summary=str(data.get("summary") or ""),
        reason=str(data.get("reason") or ""),
        scores=data.get("scores") if isinstance(data.get("scores"), dict) else {},
        visual_focus=data.get("visual_focus") if isinstance(data.get("visual_focus"), dict) else {},
    )


def clipper_job_from_dict(data: dict[str, Any]) -> ClipperJob:
    return ClipperJob(
        id=str(data.get("id") or ""),
        status=str(data.get("status") or "queued"),
        progress=int(data.get("progress") or 0),
        current_step=str(data.get("current_step") or "queued"),
        created_at=float(data.get("created_at") or time.time()),
        updated_at=float(data.get("updated_at") or time.time()),
        step_started_at=float(data.get("step_started_at") or data.get("created_at") or time.time()),
        estimated_remaining_seconds=(
            int(data["estimated_remaining_seconds"])
            if data.get("estimated_remaining_seconds") is not None
            else None
        ),
        source_url=data.get("source_url"),
        source_file=data.get("source_file"),
        original_name=data.get("original_name"),
        user_id=data.get("user_id"),
        error=data.get("error"),
        transcript=[
            transcript_segment_from_dict(item)
            for item in data.get("transcript", [])
            if isinstance(item, dict)
        ],
        candidates=[
            clip_candidate_from_dict(item)
            for item in data.get("candidates", [])
            if isinstance(item, dict)
        ],
        outputs=data.get("outputs") if isinstance(data.get("outputs"), list) else [],
        metadata_path=data.get("metadata_path"),
    )
