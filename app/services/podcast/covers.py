import json
import os
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from app.utils import utils


FONT_PATHS = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)

COVER_TEXT_POSITIONS = {"top", "middle", "bottom"}
COVER_TEMPLATES = {
    "classic": {
        "label": "Clássico",
        "fill": (255, 255, 255, 255),
        "stroke_fill": (0, 0, 0, 245),
        "stroke_width": 6,
        "accent_fill": (255, 217, 102, 235),
        "panel_fill": (0, 0, 0, 110),
        "overlay_fill": (0, 0, 0, 34),
        "font_scale": 1.0,
        "max_width": 0.86,
        "panel_mode": "legacy",
    },
    "impact": {
        "label": "Impacto",
        "fill": (255, 255, 255, 255),
        "stroke_fill": (0, 0, 0, 245),
        "stroke_width": 6,
        "accent_fill": (255, 217, 102, 235),
        "panel_fill": (0, 0, 0, 118),
        "overlay_fill": (0, 0, 0, 34),
        "font_scale": 1.0,
        "max_width": 0.86,
    },
    "clean": {
        "label": "Clean",
        "fill": (255, 255, 255, 255),
        "stroke_fill": (15, 23, 42, 220),
        "stroke_width": 4,
        "accent_fill": None,
        "panel_fill": (15, 23, 42, 92),
        "overlay_fill": (0, 0, 0, 18),
        "font_scale": 0.86,
        "max_width": 0.82,
    },
    "alert": {
        "label": "Alerta",
        "fill": (255, 221, 87, 255),
        "stroke_fill": (6, 10, 20, 255),
        "stroke_width": 8,
        "accent_fill": (239, 68, 68, 235),
        "panel_fill": (0, 0, 0, 128),
        "overlay_fill": (0, 0, 0, 42),
        "font_scale": 1.08,
        "max_width": 0.88,
    },
    "minimal": {
        "label": "Minimalista",
        "fill": (255, 255, 255, 250),
        "stroke_fill": (0, 0, 0, 210),
        "stroke_width": 3,
        "accent_fill": None,
        "panel_fill": (0, 0, 0, 72),
        "overlay_fill": (0, 0, 0, 12),
        "font_scale": 0.74,
        "max_width": 0.76,
    },
}


def generate_covers_for_job(job_id: str, variants: int = 3, frame_ratio: float = 0.35) -> list[Path]:
    job_dir = Path(utils.root_dir()) / "storage" / "tasks" / "podcast" / job_id
    metadata_path = job_dir / "metadata.json"
    if not metadata_path.is_file():
        raise FileNotFoundError(f"metadata not found: {metadata_path}")

    data = json.loads(metadata_path.read_text(encoding="utf-8"))
    outputs = data.get("outputs") if isinstance(data.get("outputs"), list) else []
    if not outputs:
        return []

    generated = attach_cover_options(job_dir, outputs, variants=variants, frame_ratio=frame_ratio)
    metadata_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return generated


def attach_cover_options(
    job_dir: str | Path,
    outputs: list[dict],
    variants: int = 3,
    frame_ratio: float = 0.35,
) -> list[Path]:
    job_path = Path(job_dir)
    covers_dir = job_path / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    labels = "abcdefghijklmnopqrstuvwxyz"
    ratios = variant_frame_ratios(frame_ratio, variants)
    generated: list[Path] = []

    for index, output in enumerate(outputs, start=1):
        video_path = Path(str(output.get("video_path") or ""))
        source_path = cover_source_path(video_path)
        if not source_path.is_file():
            continue

        title = str(output.get("cover_title") or output.get("title") or f"Podcast short {index}").strip()
        template = normalize_cover_template(output.get("cover_template"))
        text_position = normalize_cover_text_position(output.get("cover_text_position"))
        duration = float(output.get("duration") or probe_duration(source_path) or 1)
        cover_options = []
        cover_id = safe_cover_id(output, index)

        for variant_index, ratio in enumerate(ratios):
            label = labels[variant_index]
            timestamp = max(0.2, min(duration - 0.2, duration * ratio))
            frame_path = covers_dir / f"cover-{cover_id}-{label}-frame.jpg"
            cover_path = covers_dir / f"cover-{cover_id}-{label}.jpg"
            extract_frame(source_path, timestamp, frame_path)
            render_cover(frame_path, cover_path, title, template=template, text_position=text_position)
            cover_options.append(
                {
                    "label": label.upper(),
                    "frame_ratio": round(ratio, 3),
                    "timestamp": round(timestamp, 3),
                    "template": template,
                    "text_position": text_position,
                    "frame_path": str(frame_path),
                    "frame_url": task_url(frame_path),
                    "path": str(cover_path),
                    "url": task_url(cover_path),
                }
            )
            generated.append(cover_path)

        if cover_options:
            output["cover_template"] = template
            output["cover_text_position"] = text_position
            output["cover_options"] = cover_options
            output["cover_path"] = cover_options[0]["path"]
            output["cover_url"] = cover_options[0]["url"]

    return generated


def safe_cover_id(output: dict, index: int) -> str:
    raw = str(output.get("id") or f"{index:02d}").strip().lower()
    safe = "".join(ch if ch.isalnum() else "-" for ch in raw).strip("-")
    return safe or f"{index:02d}"


def variant_frame_ratios(preferred: float, variants: int) -> list[float]:
    presets = [0.28, 0.5, 0.72]
    if variants <= 1:
        return [max(0.05, min(0.95, preferred))]
    if variants <= len(presets):
        return presets[:variants]
    values = presets[:]
    step = 0.8 / max(1, variants - 1)
    for index in range(variants):
        value = round(0.1 + step * index, 3)
        if value not in values:
            values.append(value)
    return [max(0.05, min(0.95, value)) for value in values[:variants]]


def cover_source_path(video_path: Path) -> Path:
    camera_path = video_path.with_suffix("").with_suffix(".camera.mp4")
    if camera_path.is_file():
        return camera_path
    fallback_camera_path = Path(str(video_path).replace(".mp4", ".camera.mp4"))
    if fallback_camera_path.is_file():
        return fallback_camera_path
    return video_path


def extract_frame(video_path: Path, timestamp: float, output_path: Path) -> None:
    command = [
        utils.get_ffmpeg_binary(),
        "-y",
        "-ss",
        f"{timestamp:.3f}",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-q:v",
        "2",
        str(output_path),
    ]
    run(command, "failed to extract cover frame")


def render_cover(
    frame_path: Path,
    output_path: Path,
    title: str,
    template: str = "impact",
    text_position: str = "bottom",
) -> None:
    image = Image.open(frame_path).convert("RGB")
    image = ImageEnhance.Contrast(image).enhance(1.08)
    image = ImageEnhance.Color(image).enhance(1.08)
    style = cover_template_style(template)
    text_position = normalize_cover_text_position(text_position)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = image.size

    draw.rectangle((0, 0, width, height), fill=style["overlay_fill"])

    font = cover_font(title, float(style["font_scale"]))
    max_width = int(width * float(style["max_width"]))
    stroke_width = int(style["stroke_width"])
    wrapped = wrap_title(title, font, max_width, stroke_width=stroke_width)
    text_box = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=8, stroke_width=stroke_width)
    text_width = text_box[2] - text_box[0]
    text_height = text_box[3] - text_box[1]
    x = int((width - text_width) / 2)
    y = text_y_for_position(height, text_height, text_position)
    if style.get("panel_mode") == "legacy" and text_position == "bottom":
        y = int(height * 0.66 - text_height / 2)
        panel_top = int(height * 0.56)
        panel_bottom = height
    else:
        panel_top = max(0, y - 46)
        panel_bottom = min(height, y + text_height + 54)
    draw.rectangle((0, panel_top, width, panel_bottom), fill=style["panel_fill"])

    if style["accent_fill"]:
        accent_h = 14
        accent_y = max(18, y - 34)
        draw.rounded_rectangle(
            (int(width * 0.07), accent_y, int(width * 0.93), accent_y + accent_h),
            radius=9,
            fill=style["accent_fill"],
        )
    draw.multiline_text(
        (x, y),
        wrapped,
        font=font,
        fill=style["fill"],
        spacing=8,
        align="center",
        stroke_width=stroke_width,
        stroke_fill=style["stroke_fill"],
    )

    composed = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    composed = composed.filter(ImageFilter.UnsharpMask(radius=1.4, percent=115, threshold=3))
    composed.save(output_path, quality=92, optimize=True)


def cover_template_style(template: str) -> dict:
    return COVER_TEMPLATES[normalize_cover_template(template)]


def normalize_cover_template(value: object) -> str:
    key = str(value or "impact").strip().lower()
    return key if key in COVER_TEMPLATES else "impact"


def normalize_cover_text_position(value: object) -> str:
    key = str(value or "bottom").strip().lower()
    return key if key in COVER_TEXT_POSITIONS else "bottom"


def text_y_for_position(height: int, text_height: int, position: str) -> int:
    anchors = {
        "top": 0.18,
        "middle": 0.5,
        "bottom": 0.72,
    }
    y = int(height * anchors.get(position, 0.72) - text_height / 2)
    return max(64, min(height - text_height - 84, y))


def cover_font(title: str, scale: float = 1.0) -> ImageFont.FreeTypeFont:
    length = len(title)
    if length <= 22:
        size = 112
    elif length <= 34:
        size = 96
    else:
        size = 78
    return font_at(max(46, int(size * scale)))


def font_at(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default(size=size)


def wrap_title(title: str, font: ImageFont.FreeTypeFont, max_width: int, stroke_width: int = 6) -> str:
    words = title.upper().split()
    if not words:
        return "PODCAST SHORT"
    lines = []
    current = ""
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    for word in words:
        candidate = f"{current} {word}".strip()
        bbox = probe.textbbox((0, 0), candidate, font=font, stroke_width=stroke_width)
        if bbox[2] - bbox[0] <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    if len(lines) > 3:
        return "\n".join(textwrap.wrap(title.upper(), width=12)[:4])
    return "\n".join(lines)


def probe_duration(video_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def task_url(path: Path) -> str:
    normalized = str(path).replace("\\", "/")
    marker = "/storage/tasks/"
    if marker not in normalized:
        return normalized
    return "/tasks/" + normalized.split(marker, 1)[1]


def run(command: list[str], message: str) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{message}: {detail[-900:]}")
