from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean, median, pstdev
from typing import Any


DEFAULT_MODEL_PATH = "models/mediapipe/face_landmarker.task"


@dataclass
class MouthTrack:
    id: int
    samples: list[dict[str, float]] = field(default_factory=list)

    def add(self, sample: dict[str, float]) -> None:
        self.samples.append(sample)

    def last_center(self) -> tuple[float, float]:
        if not self.samples:
            return (0.5, 0.5)
        sample = self.samples[-1]
        return (sample["center_x"], sample["center_y"])

    def to_payload(self, total_samples: int) -> dict[str, Any]:
        mouth_values = [sample["mouth_open"] for sample in self.samples]
        jaw_values = [sample["jaw_open"] for sample in self.samples]
        movement = _movement_score(mouth_values)
        average_open = mean(mouth_values) if mouth_values else 0.0
        jaw_average = mean(jaw_values) if jaw_values else 0.0
        detection_ratio = len(self.samples) / max(1, total_samples)
        speaking_score = max(0.0, min(100.0, (movement * 180) + (average_open * 120) + (jaw_average * 45)))
        return {
            "track_id": self.id,
            "samples": len(self.samples),
            "detection_ratio": round(detection_ratio, 3),
            "speaking_score": round(speaking_score, 1),
            "mouth_movement": round(movement, 4),
            "mouth_open_avg": round(average_open, 4),
            "jaw_open_avg": round(jaw_average, 4),
            "center_x": round(median([sample["center_x"] for sample in self.samples]), 4),
            "center_y": round(median([sample["center_y"] for sample in self.samples]), 4),
            "face_width": round(median([sample["face_width"] for sample in self.samples]), 4),
            "face_height": round(median([sample["face_height"] for sample in self.samples]), 4),
            "timeline": [
                {
                    "timestamp": round(sample["timestamp"], 3),
                    "center_x": round(sample["center_x"], 4),
                    "center_y": round(sample["center_y"], 4),
                    "face_width": round(sample["face_width"], 4),
                    "face_height": round(sample["face_height"], 4),
                    "mouth_open": round(sample["mouth_open"], 4),
                    "jaw_open": round(sample["jaw_open"], 4),
                }
                for sample in self.samples
            ],
        }


def analyze_mouth_activity(
    source_video: str,
    start: float,
    end: float,
    model_path: str = DEFAULT_MODEL_PATH,
    sample_fps: float = 2.0,
    max_faces: int = 4,
) -> dict[str, Any]:
    """Estimate who is speaking by tracking mouth movement with MediaPipe landmarks."""

    if end <= start:
        raise RuntimeError("Intervalo invalido para analise de movimento de boca.")
    if not Path(model_path).is_file():
        raise RuntimeError(f"Modelo MediaPipe nao encontrado: {model_path}")

    try:
        import cv2  # type: ignore
        import mediapipe as mp  # type: ignore
        from mediapipe.tasks.python import BaseOptions  # type: ignore
        from mediapipe.tasks.python import vision  # type: ignore
    except Exception as exc:
        raise RuntimeError("MediaPipe nao esta instalado ou nao foi importado corretamente.") from exc

    capture = cv2.VideoCapture(source_video)
    if not capture.isOpened():
        raise RuntimeError("Nao foi possivel abrir o video para analise de boca.")

    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=max_faces,
        output_face_blendshapes=True,
    )

    tracks: list[MouthTrack] = []
    total_samples = 0
    timestamps = _sample_times(start, end, sample_fps)
    try:
        with vision.FaceLandmarker.create_from_options(options) as landmarker:
            for timestamp in timestamps:
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                total_samples += 1
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                result = landmarker.detect(image)
                blendshapes = result.face_blendshapes or []
                for index, landmarks in enumerate(result.face_landmarks or []):
                    sample = _mouth_sample(landmarks, blendshapes[index] if index < len(blendshapes) else None)
                    sample["timestamp"] = timestamp
                    _assign_track(tracks, sample)
    finally:
        capture.release()

    payloads = [track.to_payload(total_samples) for track in tracks if track.samples]
    payloads.sort(key=lambda item: (item["speaking_score"], item["detection_ratio"]), reverse=True)
    best = payloads[0] if payloads else None
    return {
        "model": "mediapipe-face-landmarker",
        "start": start,
        "end": end,
        "duration": round(end - start, 3),
        "sample_fps": sample_fps,
        "sample_count": total_samples,
        "tracks": payloads,
        "best_track": best,
        "usable": bool(best and best["speaking_score"] >= 12 and best["detection_ratio"] >= 0.15),
    }


def _mouth_sample(landmarks: list[Any], blendshapes: Any | None) -> dict[str, float]:
    left = landmarks[61]
    right = landmarks[291]
    upper = landmarks[13]
    lower = landmarks[14]
    xs = [point.x for point in landmarks]
    ys = [point.y for point in landmarks]
    face_width = max(xs) - min(xs)
    face_height = max(ys) - min(ys)
    mouth_width = _distance(left.x, left.y, right.x, right.y)
    mouth_open = _distance(upper.x, upper.y, lower.x, lower.y) / max(0.001, mouth_width)
    return {
        "center_x": (min(xs) + max(xs)) / 2,
        "center_y": (min(ys) + max(ys)) / 2,
        "face_width": face_width,
        "face_height": face_height,
        "mouth_open": mouth_open,
        "jaw_open": _blendshape_score(blendshapes, "jawOpen"),
    }


def _assign_track(tracks: list[MouthTrack], sample: dict[str, float]) -> None:
    if not tracks:
        track = MouthTrack(id=1)
        track.add(sample)
        tracks.append(track)
        return
    nearest = min(
        tracks,
        key=lambda track: _distance(sample["center_x"], sample["center_y"], *track.last_center()),
    )
    distance = _distance(sample["center_x"], sample["center_y"], *nearest.last_center())
    if distance <= 0.16:
        nearest.add(sample)
        return
    track = MouthTrack(id=len(tracks) + 1)
    track.add(sample)
    tracks.append(track)


def _blendshape_score(blendshapes: Any | None, category_name: str) -> float:
    if not blendshapes:
        return 0.0
    for category in blendshapes:
        if getattr(category, "category_name", "") == category_name:
            return float(getattr(category, "score", 0.0))
    return 0.0


def _movement_score(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    diffs = [abs(current - previous) for previous, current in zip(values, values[1:])]
    return max(mean(diffs), pstdev(values))


def _sample_times(start: float, end: float, sample_fps: float) -> list[float]:
    step = 1 / max(0.2, sample_fps)
    values = []
    current = start
    while current <= end:
        values.append(round(current, 3))
        current += step
    return values


def _distance(ax: float, ay: float, bx: float, by: float) -> float:
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
