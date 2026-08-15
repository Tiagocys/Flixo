import os
import re
import shlex
import subprocess
from pathlib import Path

from app.services.clipper.models import TranscriptSegment
from app.services.clipper.subtitle_layout import compact_subtitle_segments, write_srt
from app.services.podcast.camera import detect_speaker_camera
from app.utils import utils


_SQUARE_TOP = int((1920 - 1080) / 2)
_SUBTITLE_FONT_SIZE = 14
_SUBTITLE_MARGIN_BELOW_SQUARE = 45


def render_podcast_clip(
    source_video: str,
    start: float,
    end: float,
    transcript: list[TranscriptSegment],
    output_path: str,
    title: str = "",
    burn_subtitles: bool = True,
    remove_silence: bool = True,
    artificial_cuts: bool = True,
    visual_focus: dict | None = None,
) -> dict:
    duration = max(0.1, end - start)
    base = os.path.splitext(output_path)[0]
    cut_path = f"{base}.cut.mp4"
    working_path = cut_path

    _cut_source(source_video, start, duration, cut_path)
    keep_ranges = [(0.0, duration)]
    if remove_silence:
        silences = _detect_silences(cut_path)
        keep_ranges = _keep_ranges(duration, silences)
        if _ranges_changed(duration, keep_ranges):
            working_path = f"{base}.tight.mp4"
            _concat_ranges(cut_path, keep_ranges, working_path)

    subtitle_path = f"{base}.srt"
    subtitle_segments = _subtitle_segments(transcript, start, end, keep_ranges)
    write_srt(compact_subtitle_segments(subtitle_segments), subtitle_path)
    working_duration = _probe_duration(working_path) or _ranges_duration(keep_ranges)
    visual_focus = visual_focus or detect_speaker_camera(working_path, 0.0, working_duration)
    _format_podcast_vertical(
        input_path=working_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        title=title,
        burn_subtitles=burn_subtitles,
        artificial_cuts=artificial_cuts,
        visual_focus=visual_focus,
    )
    return {
        "video_path": output_path,
        "subtitle_path": subtitle_path,
        "duration": _probe_duration(output_path) or _ranges_duration(keep_ranges),
        "removed_silence_seconds": round(duration - _ranges_duration(keep_ranges), 2),
        "visual_focus": visual_focus or {},
        "burn_subtitles": burn_subtitles,
    }


def reburn_podcast_subtitles(
    camera_path: str,
    subtitle_path: str,
    output_path: str,
    burn_subtitles: bool = True,
) -> dict:
    if not os.path.isfile(camera_path):
        raise RuntimeError("Video base da camera nao encontrado. Renderize o short novamente.")
    if not os.path.isfile(subtitle_path):
        raise RuntimeError("Arquivo de legenda nao encontrado.")
    _apply_text_overlays(
        input_path=camera_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        title="",
        burn_subtitles=burn_subtitles,
    )
    return {
        "video_path": output_path,
        "subtitle_path": subtitle_path,
        "duration": _probe_duration(output_path),
    }


def _cut_source(source_video: str, start: float, duration: float, output_path: str) -> None:
    command = [
        utils.get_ffmpeg_binary(),
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        source_video,
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        output_path,
    ]
    _run(command, "Falha ao cortar trecho de podcast")


def _detect_silences(input_path: str) -> list[tuple[float, float]]:
    command = [
        utils.get_ffmpeg_binary(),
        "-i",
        input_path,
        "-af",
        "silencedetect=noise=-38dB:d=0.55",
        "-f",
        "null",
        "-",
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    text = f"{result.stderr}\n{result.stdout}"
    starts = [float(value) for value in re.findall(r"silence_start:\s*([0-9.]+)", text)]
    ends = [float(value) for value in re.findall(r"silence_end:\s*([0-9.]+)", text)]
    return [(start, end) for start, end in zip(starts, ends) if end > start]


def _keep_ranges(
    duration: float,
    silences: list[tuple[float, float]],
    padding: float = 0.12,
) -> list[tuple[float, float]]:
    if not silences:
        return [(0.0, duration)]
    ranges: list[tuple[float, float]] = []
    cursor = 0.0
    for silence_start, silence_end in silences:
        remove_start = max(0.0, silence_start + padding)
        remove_end = min(duration, silence_end - padding)
        if remove_end <= remove_start:
            continue
        if remove_start - cursor >= 0.25:
            ranges.append((cursor, remove_start))
        cursor = max(cursor, remove_end)
    if duration - cursor >= 0.25:
        ranges.append((cursor, duration))
    return ranges or [(0.0, duration)]


def _concat_ranges(input_path: str, ranges: list[tuple[float, float]], output_path: str) -> None:
    temp_dir = Path(output_path).with_suffix("")
    temp_dir.mkdir(parents=True, exist_ok=True)
    segment_paths = []
    for index, (start, end) in enumerate(ranges, start=1):
        segment_path = temp_dir / f"segment-{index:03d}.mp4"
        segment_paths.append(segment_path)
        _run(
            [
                utils.get_ffmpeg_binary(),
                "-y",
                "-ss",
                f"{start:.3f}",
                "-i",
                input_path,
                "-t",
                f"{end - start:.3f}",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(segment_path),
            ],
            "Falha ao cortar trecho sem silencio",
        )
    list_path = temp_dir / "concat.txt"
    with list_path.open("w", encoding="utf-8") as file:
        for segment_path in segment_paths:
            file.write(f"file {shlex.quote(str(segment_path.resolve()))}\n")
    _run(
        [
            utils.get_ffmpeg_binary(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao concatenar trechos sem silencio",
    )


def _subtitle_segments(
    transcript: list[TranscriptSegment],
    start: float,
    end: float,
    keep_ranges: list[tuple[float, float]],
) -> list[TranscriptSegment]:
    result: list[TranscriptSegment] = []
    for segment in transcript:
        if segment.end < start or segment.start > end:
            continue
        rel_start = max(0.0, segment.start - start)
        rel_end = min(end - start, segment.end - start)
        for keep_start, keep_end in keep_ranges:
            overlap_start = max(rel_start, keep_start)
            overlap_end = min(rel_end, keep_end)
            if overlap_end <= overlap_start:
                continue
            mapped_start = _map_time(overlap_start, keep_ranges)
            mapped_end = _map_time(overlap_end, keep_ranges)
            if mapped_end > mapped_start:
                result.append(
                    TranscriptSegment(
                        start=round(mapped_start, 3),
                        end=round(mapped_end, 3),
                        text=segment.text,
                    )
                )
    return result


def _map_time(value: float, keep_ranges: list[tuple[float, float]]) -> float:
    total = 0.0
    for start, end in keep_ranges:
        if value <= start:
            return total
        if value <= end:
            return total + (value - start)
        total += end - start
    return total


def _format_podcast_vertical(
    input_path: str,
    subtitle_path: str,
    output_path: str,
    title: str,
    burn_subtitles: bool,
    artificial_cuts: bool,
    visual_focus: dict | None,
) -> None:
    base = os.path.splitext(output_path)[0]
    camera_path = f"{base}.camera.mp4"
    _render_camera_base(input_path, camera_path, visual_focus, artificial_cuts)
    _apply_text_overlays(
        input_path=camera_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        title=title,
        burn_subtitles=burn_subtitles,
    )


def _render_camera_base(
    input_path: str,
    output_path: str,
    visual_focus: dict | None,
    artificial_cuts: bool,
) -> None:
    segments = visual_focus.get("segments") if isinstance(visual_focus, dict) else None
    if isinstance(segments, list) and len(segments) > 1:
        _render_segmented_camera(input_path, output_path, segments, artificial_cuts)
        return

    focused_filter = _focused_vertical_filter(visual_focus, artificial_cuts)
    video_filter = focused_filter or _square_center_filter()
    _render_camera_filter(input_path, output_path, video_filter)


def _render_camera_filter(input_path: str, output_path: str, video_filter: str) -> None:
    _run(
        [
            utils.get_ffmpeg_binary(),
            "-y",
            "-i",
            input_path,
            "-filter_complex",
            video_filter,
            "-map",
            "[v]",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao renderizar camera do podcast",
    )


def _render_segmented_camera(
    input_path: str,
    output_path: str,
    segments: list[dict],
    artificial_cuts: bool,
) -> None:
    temp_dir = Path(output_path).with_suffix("")
    temp_dir.mkdir(parents=True, exist_ok=True)
    segment_paths = []
    for index, segment in enumerate(segments, start=1):
        start = max(0.0, float(segment.get("start") or 0))
        end = max(start + 0.05, float(segment.get("end") or start + 0.05))
        segment_path = temp_dir / f"camera-{index:03d}.mp4"
        segment_paths.append(segment_path)
        if segment.get("mode") == "speaker_zoom":
            video_filter = _focused_vertical_filter(segment, artificial_cuts) or _square_center_filter()
        else:
            video_filter = _square_center_filter()
        _run(
            [
                utils.get_ffmpeg_binary(),
                "-y",
                "-ss",
                f"{start:.3f}",
                "-i",
                input_path,
                "-t",
                f"{end - start:.3f}",
                "-filter_complex",
                video_filter,
                "-map",
                "[v]",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "24",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(segment_path),
            ],
            "Falha ao renderizar trecho de camera do podcast",
        )

    list_path = temp_dir / "concat.txt"
    with list_path.open("w", encoding="utf-8") as file:
        for segment_path in segment_paths:
            file.write(f"file {shlex.quote(str(segment_path.resolve()))}\n")
    _run(
        [
            utils.get_ffmpeg_binary(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao concatenar trechos de camera do podcast",
    )


def _apply_text_overlays(
    input_path: str,
    subtitle_path: str,
    output_path: str,
    title: str,
    burn_subtitles: bool,
) -> None:
    video_filter = "[0:v]null[v]"
    map_video = "[v]"
    if burn_subtitles and os.path.isfile(subtitle_path):
        style = (
            f"FontName=Liberation Sans,FontSize={_SUBTITLE_FONT_SIZE},PrimaryColour=&H00FFFFFF,"
            "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
            f"Alignment=2,MarginV={_SUBTITLE_MARGIN_BELOW_SQUARE}"
        )
        video_filter += f";[v]subtitles={_quote_filter_path(subtitle_path)}:force_style='{style}'[vs]"
        map_video = "[vs]"

    _run(
        [
            utils.get_ffmpeg_binary(),
            "-y",
            "-i",
            input_path,
            "-filter_complex",
            video_filter,
            "-map",
            map_video,
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao renderizar podcast vertical",
    )


def _focused_vertical_filter(visual_focus: dict | None, artificial_cuts: bool) -> str:
    if not visual_focus or visual_focus.get("mode") != "speaker_zoom" or not visual_focus.get("usable"):
        return ""
    source_width = int(float(visual_focus.get("source_width") or 0))
    source_height = int(float(visual_focus.get("source_height") or 0))
    if source_width <= 0 or source_height <= 0:
        return ""

    target_ratio = 9 / 16
    if source_width / source_height > target_ratio:
        crop_h = source_height
        crop_w = int(crop_h * target_ratio)
    else:
        crop_w = source_width
        crop_h = int(crop_w / target_ratio)

    crop_w = _even(max(2, min(crop_w, source_width)))
    crop_h = _even(max(2, min(crop_h, source_height)))
    center_x = float(visual_focus.get("center_x") or source_width / 2)
    center_y = float(visual_focus.get("center_y") or source_height / 2)
    crop_x = _even(max(0, min(int(center_x - crop_w / 2), source_width - crop_w)))
    crop_y = _even(max(0, min(int(center_y - crop_h / 2), source_height - crop_h)))

    if artificial_cuts:
        scale = "scale=w='if(between(mod(t,10),3,7),1140,1080)':h=-2:eval=frame"
        return (
            f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
            f"{scale},crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1[v]"
        )
    return f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale=1080:1920,setsar=1[v]"


def _square_center_filter() -> str:
    return (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,boxblur=28:2,eq=brightness=-0.12:saturation=0.78[bg];"
        "[0:v]scale=1080:1080:force_original_aspect_ratio=increase,"
        "crop=1080:1080,eq=brightness=0.02:saturation=1.04[square];"
        f"[bg][square]overlay=x=0:y={_SQUARE_TOP}[v]"
    )


def _even(value: int) -> int:
    return value if value % 2 == 0 else max(0, value - 1)


def _quote_filter_path(path: str) -> str:
    escaped = path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return shlex.quote(escaped)


def _probe_duration(path: str) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return round(float(result.stdout.strip()), 2)
    except ValueError:
        return 0.0


def _ranges_changed(duration: float, ranges: list[tuple[float, float]]) -> bool:
    return abs(duration - _ranges_duration(ranges)) > 0.25


def _ranges_duration(ranges: list[tuple[float, float]]) -> float:
    return sum(end - start for start, end in ranges)


def _run(command: list[str], message: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{message}: {detail[-900:]}")
