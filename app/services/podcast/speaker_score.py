from __future__ import annotations

from dataclasses import replace

from loguru import logger

from app.services.clipper.models import ClipCandidate
from app.services.podcast.face_focus import apply_face_focus_filter
from app.services.podcast.mouth_focus import analyze_mouth_activity


def rank_candidates_by_editorial_and_speaker_focus(
    source_video: str,
    candidates: list[ClipCandidate],
    limit: int = 10,
) -> list[ClipCandidate]:
    """Combine LLM editorial value with face framing and mouth activity."""

    if not candidates:
        return []

    editorial_scores = {
        candidate.id: int(candidate.scores.get("overall", 0))
        for candidate in candidates
    }
    face_candidates = apply_face_focus_filter(source_video, candidates, limit=max(limit, len(candidates)))
    if not face_candidates:
        return _rank_by_mouth_focus_only(source_video, candidates, editorial_scores, limit)

    ranked: list[ClipCandidate] = []

    for candidate in face_candidates:
        mouth_focus = _safe_mouth_focus(source_video, candidate)
        visual_focus = _merge_visual_focus(candidate.visual_focus, mouth_focus)
        editorial_score = editorial_scores.get(candidate.id, int(candidate.scores.get("overall", 0)))
        face_score = int(candidate.visual_focus.get("score") or candidate.scores.get("visual_focus") or 0)
        speaker_score = int((mouth_focus.get("best_track") or {}).get("speaking_score") or 0)
        final_score = _combined_score(editorial_score, face_score, speaker_score)

        scores = dict(candidate.scores)
        scores["editorial"] = editorial_score
        scores["visual_focus"] = face_score
        scores["speaker_focus"] = speaker_score
        scores["overall"] = final_score
        ranked.append(replace(candidate, scores=scores, visual_focus=visual_focus))

    ranked.sort(key=lambda item: item.scores.get("overall", 0), reverse=True)
    logger.info("podcast speaker scoring ranked {} candidate(s)", len(ranked))
    return ranked[:limit]


def _rank_by_mouth_focus_only(
    source_video: str,
    candidates: list[ClipCandidate],
    editorial_scores: dict[str, int],
    limit: int,
) -> list[ClipCandidate]:
    width, height = _video_dimensions(source_video)
    ranked: list[ClipCandidate] = []
    for candidate in candidates:
        mouth_focus = _safe_mouth_focus(source_video, candidate)
        best_track = mouth_focus.get("best_track") or {}
        if not mouth_focus.get("usable") or not best_track:
            continue
        speaker_score = int(best_track.get("speaking_score") or 0)
        editorial_score = editorial_scores.get(candidate.id, int(candidate.scores.get("overall", 0)))
        face_score = min(62, max(38, speaker_score - 18))
        final_score = _combined_score(editorial_score, face_score, speaker_score)
        visual_focus = {
            "usable": True,
            "score": face_score,
            "source_width": width,
            "source_height": height,
            "center_x": round(float(best_track["center_x"]) * width, 2),
            "center_y": round(float(best_track["center_y"]) * height, 2),
            "reason": "Rosto falante recuperado por movimento de boca.",
            "speaker_focus": mouth_focus,
        }
        scores = dict(candidate.scores)
        scores["editorial"] = editorial_score
        scores["visual_focus"] = face_score
        scores["speaker_focus"] = speaker_score
        scores["overall"] = final_score
        ranked.append(replace(candidate, scores=scores, visual_focus=visual_focus))

    ranked.sort(key=lambda item: item.scores.get("overall", 0), reverse=True)
    logger.info("podcast mouth-only speaker scoring ranked {} candidate(s)", len(ranked))
    return ranked[:limit]


def _safe_mouth_focus(source_video: str, candidate: ClipCandidate) -> dict:
    try:
        return analyze_mouth_activity(
            source_video,
            candidate.start,
            candidate.end,
            sample_fps=1.4,
            max_faces=4,
        )
    except Exception as exc:
        logger.warning("mouth focus analysis failed for {}: {}", candidate.id, exc)
        return {
            "usable": False,
            "error": str(exc),
            "best_track": None,
            "tracks": [],
        }


def _merge_visual_focus(face_focus: dict, mouth_focus: dict) -> dict:
    merged = dict(face_focus or {})
    best_track = mouth_focus.get("best_track") or {}
    source_width = float(merged.get("source_width") or 0)
    source_height = float(merged.get("source_height") or 0)
    if mouth_focus.get("usable") and best_track and source_width > 0 and source_height > 0:
        merged["center_x"] = round(float(best_track["center_x"]) * source_width, 2)
        merged["center_y"] = round(float(best_track["center_y"]) * source_height, 2)
        merged["reason"] = "Rosto falante estimado por movimento de boca."
        merged["speaker_focus"] = mouth_focus
    else:
        merged["speaker_focus"] = mouth_focus
    return merged


def _combined_score(editorial_score: int, face_score: int, speaker_score: int) -> int:
    # LLM decides whether the conversation is worth cutting; vision decides whether it works as a vertical short.
    score = round((editorial_score * 0.52) + (face_score * 0.22) + (speaker_score * 0.26))
    return max(0, min(100, score))


def _video_dimensions(source_video: str) -> tuple[int, int]:
    try:
        import cv2  # type: ignore

        capture = cv2.VideoCapture(source_video)
        try:
            width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        finally:
            capture.release()
        if width > 0 and height > 0:
            return width, height
    except Exception:
        pass
    return 1280, 720
