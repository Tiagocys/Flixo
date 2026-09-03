import os
import re
import shlex
import subprocess
from pathlib import Path

from app.services.clipper.models import TranscriptSegment
from app.services.clipper.subtitle_layout import format_subtitle_segments, normalize_subtitle_style, write_srt
from app.services.podcast.camera import detect_speaker_camera
from app.utils import utils


_SQUARE_TOP = int((1920 - 1080) / 2)
_SUBTITLE_FONT_SIZE = 14
_SUBTITLE_MARGIN_BELOW_SQUARE = 45
_WORK_CRF = os.getenv("PODCAST_RENDER_WORK_CRF", "20")
_OUTPUT_CRF = os.getenv("PODCAST_RENDER_OUTPUT_CRF", "20")
_AUDIO_BITRATE = os.getenv("PODCAST_RENDER_AUDIO_BITRATE", "160k")
_WATERMARK_TEXT = os.getenv(
    "CLIPPER_WATERMARK_TEXT",
    os.getenv("PODCAST_WATERMARK_TEXT", "Copacabena.com"),
).strip()
_WATERMARK_ENABLED = os.getenv(
    "CLIPPER_WATERMARK_ENABLED",
    os.getenv("PODCAST_WATERMARK_ENABLED", "true"),
).strip().lower() not in {"0", "false", "no", "off"}
_WATERMARK_FONT_FILE = os.getenv(
    "CLIPPER_WATERMARK_FONT_FILE",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)


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
    clip_format: str = "auto",
    subtitle_style: str = "standard",
    subtitle_text_color: str = "white",
    subtitle_border_color: str = "black",
    subtitle_size: str = "medium",
    subtitle_position: str = "middle",
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
    subtitle_style = normalize_subtitle_style(subtitle_style)
    subtitle_text_color = normalize_subtitle_color(subtitle_text_color, "white")
    subtitle_border_color = normalize_subtitle_color(subtitle_border_color, "black")
    subtitle_size = normalize_subtitle_size(subtitle_size)
    subtitle_position = normalize_subtitle_position(subtitle_position)
    clip_format = normalize_clip_format(clip_format)
    write_srt(format_subtitle_segments(subtitle_segments, "standard"), subtitle_path)
    working_duration = _probe_duration(working_path) or _ranges_duration(keep_ranges)
    visual_focus = visual_focus or detect_speaker_camera(working_path, 0.0, working_duration)
    _format_podcast_vertical(
        input_path=working_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        title=title,
        burn_subtitles=burn_subtitles,
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        artificial_cuts=artificial_cuts,
        visual_focus=visual_focus,
        clip_format=clip_format,
    )
    return {
        "video_path": output_path,
        "subtitle_path": subtitle_path,
        "duration": _probe_duration(output_path) or _ranges_duration(keep_ranges),
        "removed_silence_seconds": round(duration - _ranges_duration(keep_ranges), 2),
        "visual_focus": visual_focus or {},
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
        "clip_format": clip_format,
    }


def reburn_podcast_subtitles(
    camera_path: str,
    subtitle_path: str,
    output_path: str,
    burn_subtitles: bool = True,
    subtitle_style: str = "standard",
    subtitle_text_color: str = "white",
    subtitle_border_color: str = "black",
    subtitle_size: str = "medium",
    subtitle_position: str = "middle",
) -> dict:
    if not os.path.isfile(camera_path):
        raise RuntimeError("Video base da camera nao encontrado. Renderize o short novamente.")
    if not os.path.isfile(subtitle_path):
        raise RuntimeError("Arquivo de legenda nao encontrado.")
    subtitle_style = normalize_subtitle_style(subtitle_style)
    subtitle_text_color = normalize_subtitle_color(subtitle_text_color, "white")
    subtitle_border_color = normalize_subtitle_color(subtitle_border_color, "black")
    subtitle_size = normalize_subtitle_size(subtitle_size)
    subtitle_position = normalize_subtitle_position(subtitle_position)
    render_width, render_height = _probe_resolution(camera_path)
    _apply_text_overlays(
        input_path=camera_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        title="",
        burn_subtitles=burn_subtitles,
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        render_width=render_width,
        render_height=render_height,
    )
    return {
        "video_path": output_path,
        "subtitle_path": subtitle_path,
        "duration": _probe_duration(output_path),
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "subtitle_text_color": subtitle_text_color,
        "subtitle_border_color": subtitle_border_color,
        "subtitle_size": subtitle_size,
        "subtitle_position": subtitle_position,
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
        _WORK_CRF,
        "-c:a",
        "aac",
        "-b:a",
        _AUDIO_BITRATE,
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
                _WORK_CRF,
                "-c:a",
                "aac",
                "-b:a",
                _AUDIO_BITRATE,
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
    subtitle_style: str,
    subtitle_text_color: str,
    subtitle_border_color: str,
    subtitle_size: str,
    subtitle_position: str,
    artificial_cuts: bool,
    visual_focus: dict | None,
    clip_format: str = "auto",
) -> None:
    base = os.path.splitext(output_path)[0]
    camera_path = f"{base}.camera.mp4"
    clip_format = normalize_clip_format(clip_format)
    _render_camera_base(input_path, camera_path, visual_focus, artificial_cuts, clip_format)
    render_width, render_height = _clip_format_resolution(clip_format)
    _apply_text_overlays(
        input_path=camera_path,
        subtitle_path=subtitle_path,
        output_path=output_path,
        title=title,
        burn_subtitles=burn_subtitles,
        subtitle_style=subtitle_style,
        subtitle_text_color=subtitle_text_color,
        subtitle_border_color=subtitle_border_color,
        subtitle_size=subtitle_size,
        subtitle_position=subtitle_position,
        render_width=render_width,
        render_height=render_height,
    )


def _render_camera_base(
    input_path: str,
    output_path: str,
    visual_focus: dict | None,
    artificial_cuts: bool,
    clip_format: str = "auto",
) -> None:
    clip_format = normalize_clip_format(clip_format)
    segments = visual_focus.get("segments") if isinstance(visual_focus, dict) else None
    if isinstance(segments, list) and len(segments) > 1:
        _render_segmented_camera(input_path, output_path, segments, artificial_cuts, clip_format)
        return

    focused_filter = _focused_filter_for_format(visual_focus, artificial_cuts, clip_format)
    video_filter = focused_filter or _fallback_filter_for_format(clip_format)
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
            _OUTPUT_CRF,
            "-c:a",
            "aac",
            "-b:a",
            _AUDIO_BITRATE,
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
    clip_format: str = "auto",
) -> None:
    clip_format = normalize_clip_format(clip_format)
    temp_dir = Path(output_path).with_suffix("")
    temp_dir.mkdir(parents=True, exist_ok=True)
    segment_paths = []
    for index, segment in enumerate(segments, start=1):
        start = max(0.0, float(segment.get("start") or 0))
        end = max(start + 0.05, float(segment.get("end") or start + 0.05))
        segment_path = temp_dir / f"camera-{index:03d}.mp4"
        segment_paths.append(segment_path)
        video_filter = _focused_filter_for_format(segment, artificial_cuts, clip_format) or _fallback_filter_for_format(clip_format)
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
                _OUTPUT_CRF,
                "-c:a",
                "aac",
                "-b:a",
                _AUDIO_BITRATE,
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
    subtitle_style: str = "standard",
    subtitle_text_color: str = "white",
    subtitle_border_color: str = "black",
    subtitle_size: str = "medium",
    subtitle_position: str = "middle",
    render_width: int = 1080,
    render_height: int = 1920,
) -> None:
    video_filter = "[0:v]null[v]"
    map_video = "[v]"
    if burn_subtitles and os.path.isfile(subtitle_path):
        ass_path = str(Path(output_path).with_suffix(".subtitle.ass"))
        render_subtitle_path = _subtitle_path_for_render(subtitle_path, output_path, subtitle_style)
        _write_ass_subtitles(
            render_subtitle_path,
            ass_path,
            subtitle_style,
            subtitle_text_color,
            subtitle_border_color,
            subtitle_size,
            subtitle_position,
            render_width,
            render_height,
        )
        video_filter += f";[v]subtitles={_quote_filter_path(ass_path)}[vs]"
        map_video = "[vs]"

    watermark_filter = _watermark_filter(render_width, render_height)
    if watermark_filter:
        video_filter += f";{map_video}{watermark_filter}[vw]"
        map_video = "[vw]"

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
            _OUTPUT_CRF,
            "-c:a",
            "aac",
            "-b:a",
            _AUDIO_BITRATE,
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Falha ao renderizar podcast vertical",
    )


def _subtitle_path_for_render(subtitle_path: str, output_path: str, subtitle_style: str) -> str:
    style = normalize_subtitle_style(subtitle_style)
    if style != "word":
        return subtitle_path
    events = [
        TranscriptSegment(start=start, end=end, text=text)
        for start, end, text in _read_srt_events(subtitle_path)
    ]
    render_path = str(Path(output_path).with_suffix(".render.srt"))
    write_srt(format_subtitle_segments(events, style), render_path)
    return render_path


def _subtitle_force_style(
    subtitle_style: str,
    text_color: str = "white",
    border_color: str = "black",
    subtitle_size: str = "medium",
    subtitle_position: str = "middle",
) -> str:
    primary = _ass_color(normalize_subtitle_color(text_color, "white"))
    outline = _ass_color(normalize_subtitle_color(border_color, "black"))
    style = normalize_subtitle_style(subtitle_style)
    font_size = _subtitle_font_size(style, subtitle_size)
    alignment, margin_v = _subtitle_alignment(subtitle_position)
    if style == "word":
        return (
            f"FontName=Liberation Sans,FontSize={font_size},PrimaryColour={primary},"
            f"OutlineColour={outline},BorderStyle=1,Outline=3,Shadow=0,"
            f"Bold=1,Alignment={alignment},MarginV={margin_v}"
        )
    return (
        f"FontName=Liberation Sans,FontSize={font_size},PrimaryColour={primary},"
        f"OutlineColour={outline},BorderStyle=1,Outline=2,Shadow=0,"
        f"Alignment={alignment},MarginV={margin_v}"
    )


def _write_ass_subtitles(
    srt_path: str,
    ass_path: str,
    subtitle_style: str = "standard",
    text_color: str = "white",
    border_color: str = "black",
    subtitle_size: str = "medium",
    subtitle_position: str = "middle",
    render_width: int = 1080,
    render_height: int = 1920,
) -> str:
    style = normalize_subtitle_style(subtitle_style)
    font_size = _subtitle_font_size(style, subtitle_size)
    alignment, margin_v = _subtitle_alignment(subtitle_position, render_width, render_height)
    outline = 8 if style == "word" else 5
    events = _read_srt_events(srt_path)
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {render_width}",
        f"PlayResY: {render_height}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        (
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
        ),
        (
            f"Style: Default,Liberation Sans,{font_size},{_ass_color(normalize_subtitle_color(text_color, 'white'))},"
            f"&H00FFFFFF,{_ass_color(normalize_subtitle_color(border_color, 'black'))},&H00000000,"
            f"-1,0,0,0,100,100,0,0,1,{outline},0,{alignment},60,60,{margin_v},1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for start, end, text in events:
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{_ass_text(text)}")
    Path(ass_path).write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return ass_path


def _watermark_filter(render_width: int = 1080, render_height: int = 1920) -> str:
    if not _WATERMARK_ENABLED or not _WATERMARK_TEXT:
        return ""
    base = max(1, min(render_width, render_height))
    font_size = max(22, int(base * 0.038))
    margin = max(28, int(base * 0.035))
    font_option = ""
    if _WATERMARK_FONT_FILE and os.path.isfile(_WATERMARK_FONT_FILE):
        font_option = f"fontfile={_escape_drawtext_value(_WATERMARK_FONT_FILE)}:"
    text = _escape_drawtext_value(_WATERMARK_TEXT)
    return (
        f"drawtext={font_option}text='{text}':"
        f"x=w-tw-{margin}:y={margin}:fontsize={font_size}:"
        "fontcolor=white@0.76:bordercolor=black@0.58:borderw=3:"
        "shadowcolor=black@0.35:shadowx=2:shadowy=2"
    )


def _escape_drawtext_value(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace(",", "\\,")
    )


def _read_srt_events(path: str) -> list[tuple[float, float, str]]:
    content = Path(path).read_text(encoding="utf-8", errors="ignore").replace("\r\n", "\n").strip()
    if not content:
        return []
    events: list[tuple[float, float, str]] = []
    for block in re.split(r"\n\s*\n", content):
        lines = [line.strip("\ufeff") for line in block.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        time_index = next((index for index, line in enumerate(lines) if "-->" in line), -1)
        if time_index < 0:
            continue
        start_raw, end_raw = [part.strip() for part in lines[time_index].split("-->", 1)]
        start = _srt_time_to_seconds(start_raw)
        end = _srt_time_to_seconds(end_raw)
        text = "\n".join(lines[time_index + 1 :]).strip()
        if end > start and text:
            events.append((start, end, text))
    return events


def _srt_time_to_seconds(value: str) -> float:
    match = re.match(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})", value.strip())
    if not match:
        return 0.0
    hours, minutes, seconds, millis = match.groups()
    return (
        int(hours) * 3600
        + int(minutes) * 60
        + int(seconds)
        + int(millis.ljust(3, "0")[:3]) / 1000
    )


def _ass_time(value: float) -> str:
    total_centiseconds = max(0, int(round(value * 100)))
    centiseconds = total_centiseconds % 100
    total_seconds = total_centiseconds // 100
    seconds = total_seconds % 60
    total_minutes = total_seconds // 60
    minutes = total_minutes % 60
    hours = total_minutes // 60
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def _ass_text(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", r"\N")
    )


def normalize_subtitle_color(value: str | None, fallback: str = "white") -> str:
    color = str(value or fallback).strip().lower()
    return color if color in {"white", "yellow", "black", "blue", "red"} else fallback


def normalize_subtitle_size(value: str | None, fallback: str = "medium") -> str:
    size = str(value or fallback).strip().lower()
    return size if size in {"small", "medium", "large"} else fallback


def normalize_subtitle_position(value: str | None, fallback: str = "middle") -> str:
    position = str(value or fallback).strip().lower()
    return position if position in {"top", "middle", "bottom"} else fallback


def normalize_clip_format(value: str | None, fallback: str = "auto") -> str:
    clip_format = str(value or fallback).strip().lower()
    aliases = {
        "9:16": "vertical",
        "portrait": "vertical",
        "1:1": "square",
        "16:9": "landscape",
        "horizontal": "landscape",
    }
    clip_format = aliases.get(clip_format, clip_format)
    return clip_format if clip_format in {"auto", "vertical", "square", "landscape"} else fallback


def _subtitle_font_size(subtitle_style: str, subtitle_size: str) -> int:
    size = normalize_subtitle_size(subtitle_size)
    if normalize_subtitle_style(subtitle_style) == "word":
        return {"small": 82, "medium": 102, "large": 122}[size]
    return {"small": 52, "medium": 64, "large": 78}[size]


def _subtitle_alignment(subtitle_position: str, render_width: int = 1080, render_height: int = 1920) -> tuple[int, int]:
    position = normalize_subtitle_position(subtitle_position)
    if render_width != 1080 or render_height != 1920:
        if position == "top":
            return 8, max(36, int(render_height * 0.08))
        if position == "bottom":
            return 2, max(36, int(render_height * 0.08))
        return 5, 0
    if position == "top":
        # The podcast layout keeps a 1080x1080 square centered from y=420 to y=1500.
        # Top/bottom subtitles should hug that square instead of the canvas edges.
        return 8, 300
    if position == "bottom":
        return 2, 270
    return 5, 0


def _ass_color(color: str) -> str:
    return {
        "white": "&H00FFFFFF",
        "yellow": "&H0000FFFF",
        "black": "&H00000000",
        "blue": "&H00F8BD38",
        "red": "&H004444EF",
    }[normalize_subtitle_color(color, "white")]


def _focused_vertical_filter(visual_focus: dict | None, artificial_cuts: bool) -> str:
    return _focused_aspect_filter(visual_focus, artificial_cuts, 1080, 1920)


def _focused_filter_for_format(visual_focus: dict | None, artificial_cuts: bool, clip_format: str) -> str:
    fmt = normalize_clip_format(clip_format)
    if fmt == "square":
        return _focused_aspect_filter(visual_focus, artificial_cuts, 1080, 1080)
    if fmt == "landscape":
        return _focused_aspect_filter(visual_focus, artificial_cuts, 1920, 1080)
    return _focused_aspect_filter(visual_focus, artificial_cuts, 1080, 1920)


def _focused_aspect_filter(
    visual_focus: dict | None,
    artificial_cuts: bool,
    target_width: int,
    target_height: int,
) -> str:
    if not visual_focus or visual_focus.get("mode") != "speaker_zoom" or not visual_focus.get("usable"):
        return ""
    source_width = int(float(visual_focus.get("source_width") or 0))
    source_height = int(float(visual_focus.get("source_height") or 0))
    if source_width <= 0 or source_height <= 0:
        return ""

    target_ratio = target_width / target_height
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
        zoom_width = _even(int(target_width * 1.055))
        scale = f"scale=w='if(between(mod(t,10),3,7),{zoom_width},{target_width})':h=-2:eval=frame"
        return (
            f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
            f"{scale},crop={target_width}:{target_height}:(iw-{target_width})/2:(ih-{target_height})/2,setsar=1[v]"
        )
    return f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={target_width}:{target_height},setsar=1[v]"


def _clip_format_resolution(clip_format: str) -> tuple[int, int]:
    fmt = normalize_clip_format(clip_format)
    if fmt == "square":
        return 1080, 1080
    if fmt == "landscape":
        return 1920, 1080
    return 1080, 1920


def _fallback_filter_for_format(clip_format: str) -> str:
    fmt = normalize_clip_format(clip_format)
    if fmt == "auto":
        return _square_center_filter()
    width, height = _clip_format_resolution(fmt)
    return _center_crop_filter(width, height)


def _center_crop_filter(width: int, height: int) -> str:
    return (
        f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},setsar=1[v]"
    )


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


def _probe_resolution(path: str) -> tuple[int, int]:
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
            "csv=s=x:p=0",
            path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    match = re.search(r"(\d+)x(\d+)", result.stdout or "")
    if not match:
        return 1080, 1920
    return int(match.group(1)), int(match.group(2))


def _ranges_changed(duration: float, ranges: list[tuple[float, float]]) -> bool:
    return abs(duration - _ranges_duration(ranges)) > 0.25


def _ranges_duration(ranges: list[tuple[float, float]]) -> float:
    return sum(end - start for start, end in ranges)


def _run(command: list[str], message: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{message}: {detail[-900:]}")
