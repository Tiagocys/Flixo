from __future__ import annotations

from dataclasses import replace
from statistics import median
from typing import Any

from loguru import logger

from app.services.clipper.models import ClipCandidate


def apply_face_focus_filter(
    source_video: str,
    candidates: list[ClipCandidate],
    limit: int = 10,
) -> list[ClipCandidate]:
    """Rank podcast candidates by whether a single face is centered and usable."""

    try:
        import cv2  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "OpenCV nao esta instalado. Rode `uv sync` ou instale `opencv-python-headless` "
            "para usar a selecao de cortes por rosto."
        ) from exc

    detector = _load_detector(cv2)
    capture = cv2.VideoCapture(source_video)
    if not capture.isOpened():
        raise RuntimeError("Nao foi possivel abrir o video para analise facial.")

    try:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if width <= 0 or height <= 0:
            raise RuntimeError("Nao foi possivel ler as dimensoes do video para analise facial.")

        focused: list[ClipCandidate] = []
        rejected = 0
        for candidate in candidates:
            focus = _analyze_candidate(cv2, capture, detector, candidate, width, height)
            if focus["usable"]:
                scores = dict(candidate.scores)
                original = int(scores.get("overall", 0))
                scores["visual_focus"] = int(focus["score"])
                scores["overall"] = min(100, round((original * 0.68) + (focus["score"] * 0.32)))
                focused.append(replace(candidate, scores=scores, visual_focus=focus))
            else:
                rejected += 1

        focused.sort(key=lambda item: item.scores.get("overall", 0), reverse=True)
        logger.info(
            "podcast face focus filter kept {} candidate(s), rejected {} candidate(s)",
            len(focused),
            rejected,
        )
        if focused:
            return focused[:limit]

        # Fallback keeps the project usable, but exposes a low visual score in the UI.
        logger.warning("podcast face focus filter found no usable single-face candidates")
        return []
    finally:
        capture.release()


def _load_detector(cv2: Any):
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(cascade_path)
    if detector.empty():
        raise RuntimeError("Nao foi possivel carregar o detector facial do OpenCV.")
    return detector


def _analyze_candidate(
    cv2: Any,
    capture: Any,
    detector: Any,
    candidate: ClipCandidate,
    width: int,
    height: int,
) -> dict[str, Any]:
    sample_times = _sample_times(candidate.start, candidate.end)
    detections = []
    for timestamp in sample_times:
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000.0)
        ok, frame = capture.read()
        if not ok or frame is None:
            continue
        detections.append(_detect_frame(cv2, detector, frame, width, height))

    valid = [item for item in detections if item["face_count"] > 0]
    if not detections or not valid:
        return _focus_payload(False, 0, width, height, width / 2, height / 2, reason="Sem rosto detectado.")

    single = [item for item in valid if item["face_count"] == 1]
    dominant = [item for item in valid if item["dominant_face"]]
    centered = [item for item in dominant if item["center_distance"] <= 0.26]
    closeup = [item for item in dominant if item["face_area_ratio"] >= 0.025 or item["face_height_ratio"] >= 0.15]
    multi = [item for item in valid if item["face_count"] >= 3]

    single_ratio = len(single) / len(detections)
    dominant_ratio = len(dominant) / len(detections)
    centered_ratio = len(centered) / len(detections)
    closeup_ratio = len(closeup) / len(detections)
    multi_ratio = len(multi) / len(detections)
    valid_ratio = len(valid) / len(detections)

    focus_points = closeup or dominant or centered or single or valid
    center_x = median([item["center_x"] for item in focus_points])
    center_y = median([item["center_y"] for item in focus_points])
    median_area = median([item["face_area_ratio"] for item in focus_points])
    median_height = median([item["face_height_ratio"] for item in focus_points])

    score = round(
        (valid_ratio * 24)
        + (single_ratio * 14)
        + (dominant_ratio * 32)
        + (centered_ratio * 10)
        + (closeup_ratio * 26)
        - (multi_ratio * 22)
    )
    score = max(0, min(100, score))
    usable = score >= 46 and dominant_ratio >= 0.34 and valid_ratio >= 0.34 and multi_ratio <= 0.50
    reason = (
        "Rosto dominante detectado para crop vertical."
        if usable
        else "Cena aberta, rosto ausente ou muitas faces pequenas."
    )

    return _focus_payload(
        usable,
        score,
        width,
        height,
        center_x,
        center_y,
        reason=reason,
        sample_count=len(detections),
        valid_face_ratio=round(valid_ratio, 3),
        single_face_ratio=round(single_ratio, 3),
        dominant_face_ratio=round(dominant_ratio, 3),
        centered_ratio=round(centered_ratio, 3),
        closeup_ratio=round(closeup_ratio, 3),
        multi_face_ratio=round(multi_ratio, 3),
        median_face_area_ratio=round(median_area, 4),
        median_face_height_ratio=round(median_height, 4),
    )


def _detect_frame(cv2: Any, detector: Any, frame: Any, width: int, height: int) -> dict[str, float | int]:
    resized = frame
    scale = 1.0
    if width > 960:
        scale = 960 / width
        resized = cv2.resize(frame, (960, max(1, int(height * scale))))
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    faces = detector.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(34, 34))
    normalized_faces = []
    for x, y, w, h in faces:
        original = (x / scale, y / scale, w / scale, h / scale)
        normalized_faces.append(original)
    face_count = len(normalized_faces)
    if not normalized_faces:
        return {
            "face_count": 0,
            "center_x": width / 2,
            "center_y": height / 2,
            "center_distance": 1.0,
            "face_area_ratio": 0.0,
            "face_height_ratio": 0.0,
            "dominant_face": False,
        }

    ranked = sorted(normalized_faces, key=lambda item: item[2] * item[3], reverse=True)
    x, y, w, h = ranked[0]
    largest_area = (w * h) / max(1, width * height)
    second_area = (ranked[1][2] * ranked[1][3]) / max(1, width * height) if len(ranked) > 1 else 0.0
    center_x = x + w / 2
    center_y = y + h / 2
    dx = abs(center_x - width / 2) / width
    dy = abs(center_y - height / 2) / height
    center_distance = (dx**2 + dy**2) ** 0.5
    face_height_ratio = h / max(1, height)
    dominant_face = (
        face_count <= 2
        or (largest_area >= 0.018 and largest_area >= second_area * 1.85)
        or (face_height_ratio >= 0.20 and largest_area >= second_area * 1.45)
    )
    return {
        "face_count": face_count,
        "center_x": float(center_x),
        "center_y": float(center_y),
        "center_distance": float(center_distance),
        "face_area_ratio": float(largest_area),
        "face_height_ratio": float(face_height_ratio),
        "dominant_face": dominant_face,
    }


def _focus_payload(
    usable: bool,
    score: int,
    width: int,
    height: int,
    center_x: float,
    center_y: float,
    **extra: Any,
) -> dict[str, Any]:
    payload = {
        "usable": usable,
        "score": score,
        "source_width": width,
        "source_height": height,
        "center_x": round(center_x, 2),
        "center_y": round(center_y, 2),
    }
    payload.update(extra)
    return payload


def _sample_times(start: float, end: float) -> list[float]:
    duration = max(0.0, end - start)
    if duration <= 0:
        return []
    count = max(4, min(10, int(duration // 6) + 4))
    if count == 1:
        return [start + duration / 2]
    step = duration / (count + 1)
    return [start + step * index for index in range(1, count + 1)]
