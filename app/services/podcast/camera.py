from __future__ import annotations

import subprocess
from statistics import median
from typing import Any

from loguru import logger

from app.services.podcast.mouth_focus import analyze_mouth_activity


def detect_speaker_camera(source_video: str, start: float, end: float) -> dict[str, Any]:
    """Choose camera treatment without changing the editorial score."""

    width, height = _video_dimensions(source_video)
    fallback = _square_payload(width, height, "Rosto falante claro nao detectado; usando quadro 1:1 centralizado.")
    try:
        mouth_focus = analyze_mouth_activity(
            source_video,
            start,
            end,
            sample_fps=1.4,
            max_faces=4,
        )
    except Exception as exc:
        logger.warning("podcast camera speaker detection failed: {}", exc)
        fallback["error"] = str(exc)
        fallback["segments"] = [_segment_payload(0.0, max(0.1, end - start), fallback)]
        return fallback

    best_track = mouth_focus.get("best_track") or {}
    if not _is_clear_speaking_face(mouth_focus, best_track):
        fallback["speaker_focus"] = mouth_focus
        fallback["segments"] = [_segment_payload(0.0, max(0.1, end - start), fallback)]
        return fallback

    segments = _camera_segments(best_track, width, height, start, end)
    speaker_segments = [segment for segment in segments if segment["mode"] == "speaker_zoom"]
    primary_mode = "speaker_zoom" if speaker_segments else "square_center"
    usable = bool(speaker_segments)
    return {
        "mode": primary_mode,
        "usable": usable,
        "score": int(min(100, max(45, float(best_track.get("speaking_score") or 0)))),
        "source_width": width,
        "source_height": height,
        "center_x": round(float(best_track.get("center_x") or 0.5) * width, 2),
        "center_y": round(float(best_track.get("center_y") or 0.5) * height, 2),
        "face_width_ratio": float(best_track.get("face_width") or 0),
        "face_height_ratio": float(best_track.get("face_height") or 0),
        "reason": "Rosto falante claro detectado; aplicando zoom/reframe no locutor.",
        "speaker_focus": mouth_focus,
        "segments": segments,
    }


def _is_clear_speaking_face(mouth_focus: dict[str, Any], best_track: dict[str, Any]) -> bool:
    if not mouth_focus.get("usable") or not best_track:
        return False
    detection_ratio = float(best_track.get("detection_ratio") or 0)
    speaking_score = float(best_track.get("speaking_score") or 0)
    face_width = float(best_track.get("face_width") or 0)
    face_height = float(best_track.get("face_height") or 0)
    face_clear = face_height >= 0.12 or face_width >= 0.08
    return detection_ratio >= 0.18 and speaking_score >= 12 and face_clear


def _camera_segments(
    best_track: dict[str, Any],
    width: int,
    height: int,
    start: float,
    end: float,
    window_seconds: float = 2.0,
) -> list[dict[str, Any]]:
    duration = max(0.1, end - start)
    samples = best_track.get("timeline") if isinstance(best_track.get("timeline"), list) else []
    segments: list[dict[str, Any]] = []
    cursor = 0.0
    while cursor < duration - 0.001:
        next_cursor = min(duration, cursor + window_seconds)
        absolute_start = start + cursor
        absolute_end = start + next_cursor
        window_samples = [
            sample
            for sample in samples
            if absolute_start - 0.001 <= float(sample.get("timestamp") or -1) < absolute_end + 0.001
        ]
        payload = _window_payload(window_samples, width, height)
        segments.append(_segment_payload(cursor, next_cursor, payload))
        cursor = next_cursor
    return _merge_segments(segments)


def _window_payload(samples: list[dict[str, Any]], width: int, height: int) -> dict[str, Any]:
    clear_samples = [sample for sample in samples if _sample_has_clear_centered_face(sample)]
    if not clear_samples:
        return _square_payload(width, height, "Locutor sem rosto centralizado neste trecho; usando quadro 1:1.")
    center_x = median([float(sample.get("center_x") or 0.5) for sample in clear_samples])
    center_y = median([float(sample.get("center_y") or 0.5) for sample in clear_samples])
    face_width = median([float(sample.get("face_width") or 0) for sample in clear_samples])
    face_height = median([float(sample.get("face_height") or 0) for sample in clear_samples])
    return {
        "mode": "speaker_zoom",
        "usable": True,
        "score": 65,
        "source_width": width,
        "source_height": height,
        "center_x": round(center_x * width, 2),
        "center_y": round(center_y * height, 2),
        "face_width_ratio": round(face_width, 4),
        "face_height_ratio": round(face_height, 4),
        "reason": "Rosto falante centralizado neste trecho.",
    }


def _sample_has_clear_centered_face(sample: dict[str, Any]) -> bool:
    center_x = float(sample.get("center_x") or 0.5)
    center_y = float(sample.get("center_y") or 0.5)
    face_width = float(sample.get("face_width") or 0)
    face_height = float(sample.get("face_height") or 0)
    face_clear = face_height >= 0.12 or face_width >= 0.08
    centered = abs(center_x - 0.5) <= 0.24 and abs(center_y - 0.5) <= 0.28
    return face_clear and centered


def _segment_payload(start: float, end: float, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "start": round(start, 3),
        "end": round(end, 3),
        "mode": payload.get("mode") or "square_center",
        "usable": bool(payload.get("usable")),
        "source_width": int(float(payload.get("source_width") or 0)),
        "source_height": int(float(payload.get("source_height") or 0)),
        "center_x": float(payload.get("center_x") or 0),
        "center_y": float(payload.get("center_y") or 0),
        "reason": str(payload.get("reason") or ""),
    }


def _merge_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for segment in segments:
        if not merged:
            merged.append(segment)
            continue
        previous = merged[-1]
        same_mode = previous["mode"] == segment["mode"]
        stable_center = (
            segment["mode"] != "speaker_zoom"
            or (
                abs(float(previous.get("center_x") or 0) - float(segment.get("center_x") or 0)) <= 90
                and abs(float(previous.get("center_y") or 0) - float(segment.get("center_y") or 0)) <= 70
            )
        )
        if same_mode and stable_center:
            previous["end"] = segment["end"]
            continue
        merged.append(segment)
    return merged


def _square_payload(width: int, height: int, reason: str) -> dict[str, Any]:
    return {
        "mode": "square_center",
        "usable": False,
        "score": 0,
        "source_width": width,
        "source_height": height,
        "center_x": round(width / 2, 2),
        "center_y": round(height / 2, 2),
        "reason": reason,
        "segments": [
            {
                "start": 0.0,
                "end": 0.1,
                "mode": "square_center",
                "usable": False,
                "source_width": width,
                "source_height": height,
                "center_x": round(width / 2, 2),
                "center_y": round(height / 2, 2),
                "reason": reason,
            }
        ],
    }


def _video_dimensions(source_video: str) -> tuple[int, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            source_video,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        width_text, height_text = result.stdout.strip().split("x", 1)
        width = int(width_text)
        height = int(height_text)
        if width > 0 and height > 0:
            return width, height
    except Exception:
        pass
    return 1280, 720
