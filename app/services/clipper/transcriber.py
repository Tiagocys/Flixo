import os
import re
import subprocess

from app.services import subtitle
from app.services.clipper.models import TranscriptSegment
from app.utils import utils


_SRT_TIME_RE = re.compile(
    r"(?P<h>\d{2}):(?P<m>\d{2}):(?P<s>\d{2}),(?P<ms>\d{3})"
)


def _time_to_seconds(value: str) -> float:
    match = _SRT_TIME_RE.match(value.strip())
    if not match:
        return 0.0
    return (
        int(match.group("h")) * 3600
        + int(match.group("m")) * 60
        + int(match.group("s"))
        + int(match.group("ms")) / 1000
    )


def extract_audio(video_path: str, output_dir: str) -> str:
    output = os.path.join(output_dir, "source-audio.wav")
    command = [
        utils.get_ffmpeg_binary(),
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        output,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Falha ao extrair audio com FFmpeg: {detail[-700:]}")
    return output


def transcribe_video(
    video_path: str,
    output_dir: str,
    progress_callback=None,
) -> tuple[list[TranscriptSegment], str]:
    audio_path = extract_audio(video_path, output_dir)
    subtitle_path = os.path.join(output_dir, "source.srt")
    subtitle.create(audio_path, subtitle_path, progress_callback=progress_callback)
    if not os.path.isfile(subtitle_path):
        raise RuntimeError(
            "Whisper nao gerou legenda. O Clipper usa faster-whisper e baixa o "
            "modelo automaticamente no primeiro uso. Se falhar, verifique a rede "
            "para Hugging Face ou defina WHISPER_MODEL_SIZE=small/base/tiny."
        )
    segments = parse_srt(subtitle_path)
    if not segments:
        raise RuntimeError("A transcricao nao encontrou falas suficientes para sugerir cortes.")
    return segments, subtitle_path


def parse_srt(path: str) -> list[TranscriptSegment]:
    items = subtitle.file_to_subtitles(path)
    segments: list[TranscriptSegment] = []
    for _, timing, text in items:
        if " --> " not in timing:
            continue
        start_text, end_text = timing.split(" --> ", 1)
        clean_text = " ".join(text.split())
        if not clean_text:
            continue
        segments.append(
            TranscriptSegment(
                start=_time_to_seconds(start_text),
                end=_time_to_seconds(end_text),
                text=clean_text,
            )
        )
    return segments


def write_adjusted_srt(
    segments: list[TranscriptSegment],
    start: float,
    end: float,
    output_path: str,
) -> str:
    lines = []
    idx = 1
    for segment in segments:
        if segment.end < start or segment.start > end:
            continue
        adjusted_start = max(0.0, segment.start - start)
        adjusted_end = min(end - start, segment.end - start)
        if adjusted_end <= adjusted_start:
            continue
        lines.append(utils.text_to_srt(idx, segment.text, adjusted_start, adjusted_end))
        idx += 1
    with open(output_path, "w", encoding="utf-8") as file:
        file.write("\n".join(lines).strip() + "\n")
    return output_path
