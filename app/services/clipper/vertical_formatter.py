import os
import shlex
import subprocess

from app.utils import utils


def render_vertical_clip(
    source_video: str,
    start: float,
    duration: float,
    subtitle_path: str,
    output_path: str,
    title: str = "",
    burn_subtitles: bool = True,
) -> str:
    temp_path = os.path.splitext(output_path)[0] + ".cut.mp4"
    _cut_source(source_video, start, duration, temp_path)
    _format_vertical(temp_path, subtitle_path, output_path, title, burn_subtitles)
    return output_path


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
    _run(command, "Falha ao cortar o trecho com FFmpeg")


def _format_vertical(
    input_path: str,
    subtitle_path: str,
    output_path: str,
    title: str,
    burn_subtitles: bool,
) -> None:
    title_path = _write_title_file(output_path, title)
    video_filter = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,boxblur=24:2[bg];"
        "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
    )
    map_video = "[v]"
    if burn_subtitles and os.path.isfile(subtitle_path):
        style = (
            "FontName=Liberation Sans,FontSize=8,PrimaryColour=&H00FFFFFF,"
            "OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,"
            "Alignment=2,MarginV=60"
        )
        quoted_subtitle = _quote_filter_path(subtitle_path)
        video_filter += f";[v]subtitles={quoted_subtitle}:force_style='{style}'[vs]"
        map_video = "[vs]"

    if title_path:
        quoted_title = _quote_filter_path(title_path)
        video_filter += (
            f";{map_video}drawbox=x=0:y=58:w=iw:h=190:color=black@0.55:t=fill[title_bg];"
            f"[title_bg]drawtext=textfile={quoted_title}:font='Liberation Sans':"
            "fontsize=54:fontcolor=white:borderw=3:bordercolor=black:"
            "line_spacing=8:x=(w-text_w)/2:y=102:"
            "box=0:fix_bounds=1[vt]"
        )
        map_video = "[vt]"

    command = [
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
    ]
    _run(command, "Falha ao converter o corte para vertical")


def _quote_filter_path(path: str) -> str:
    escaped = path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return shlex.quote(escaped)


def _write_title_file(output_path: str, title: str) -> str:
    value = " ".join((title or "").strip().split())
    if not value:
        return ""
    if len(value) > 64:
        value = value[:61].rstrip() + "..."
    title_path = os.path.splitext(output_path)[0] + ".title.txt"
    with open(title_path, "w", encoding="utf-8") as file:
        file.write(value)
    return title_path


def _run(command: list[str], message: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{message}: {detail[-900:]}")
