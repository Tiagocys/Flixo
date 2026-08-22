import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


YTDLP_MANUAL_UPLOAD_MESSAGE = (
    "Não foi possível baixar este vídeo do YouTube automaticamente neste momento. "
    "Use o upload manual do arquivo para continuar."
)


def ytdlp_command_base() -> list[str]:
    if importlib.util.find_spec("yt_dlp"):
        return [sys.executable, "-m", "yt_dlp"]
    binary = shutil.which("yt-dlp")
    if not binary:
        raise RuntimeError("yt-dlp nao esta instalado no ambiente.")
    return [binary]


def ytdlp_common_args() -> list[str]:
    args = [
        "--force-ipv4",
        "--newline",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
        "--retry-sleep",
        "linear=1::2",
    ]

    js_runtime = _js_runtime_arg()
    if js_runtime:
        args.extend(["--js-runtimes", js_runtime])

    cookies_file = _cookies_file_arg()
    if cookies_file:
        if not os.path.isfile(cookies_file):
            raise RuntimeError(f"YTDLP_COOKIES_FILE nao encontrado: {cookies_file}")
        args.extend(["--cookies", cookies_file])

    cookies_from_browser = (os.getenv("YTDLP_COOKIES_FROM_BROWSER") or "").strip()
    if cookies_from_browser:
        args.extend(["--cookies-from-browser", cookies_from_browser])

    extractor_args = (os.getenv("YTDLP_EXTRACTOR_ARGS") or "").strip()
    if extractor_args:
        args.extend(["--extractor-args", extractor_args])

    impersonate = (os.getenv("YTDLP_IMPERSONATE") or "").strip()
    if impersonate:
        args.extend(["--impersonate", impersonate])

    user_agent = (os.getenv("YTDLP_USER_AGENT") or "").strip()
    if user_agent:
        args.extend(["--user-agent", user_agent])

    return args


def ytdlp_probe_metadata(url: str, timeout: int = 45) -> dict:
    command = [
        *ytdlp_command_base(),
        *ytdlp_common_args(),
        "--skip-download",
        "--dump-single-json",
        "--no-playlist",
        url,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(ytdlp_error_detail(result.stderr, result.stdout))
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("yt-dlp nao retornou metadata JSON valida.") from exc


def _js_runtime_arg() -> str:
    configured = (os.getenv("YTDLP_JS_RUNTIME") or "").strip()
    if configured:
        return configured

    project_root = Path(__file__).resolve().parents[2]
    bundled_deno = project_root / ".tools" / "deno" / "deno"
    if bundled_deno.is_file():
        return f"deno:{bundled_deno}"

    local_deno = project_root / "node_modules" / ".bin" / "deno"
    if local_deno.is_file():
        return f"deno:{local_deno}"
    deno_path = shutil.which("deno")
    if deno_path:
        return f"deno:{deno_path}"

    node_path = shutil.which("node")
    if node_path:
        return f"node:{node_path}"

    return ""


def _cookies_file_arg() -> str:
    configured = (os.getenv("YTDLP_COOKIES_FILE") or "").strip()
    if configured:
        return configured

    project_root = Path(__file__).resolve().parents[2]
    candidates = [
        project_root.parent / "youtube-cookies.txt",
        project_root.parent / "cookies.txt",
        project_root / "youtube-cookies.txt",
        project_root / "cookies.txt",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)

    return ""


def ytdlp_error_detail(stderr: str, stdout: str, limit: int = 900) -> str:
    detail = (stderr or stdout or "").strip()
    if "No supported JavaScript runtime could be found" in detail and not _js_runtime_arg():
        detail += (
            "\n\nDica: instale Node.js ou Deno, ou configure YTDLP_JS_RUNTIME=node:/caminho/do/node "
            "no .env. O YouTube agora exige runtime JavaScript para alguns formatos."
        )
    if "HTTP Error 403" in detail and not (_cookies_file_arg() or os.getenv("YTDLP_COOKIES_FROM_BROWSER")):
        detail += (
            "\n\nDica: o YouTube bloqueou o download com 403. Para videos restritos, "
            "exporte os cookies do navegador para /home/projeto-mae/youtube-cookies.txt "
            "ou configure YTDLP_COOKIES_FILE no .env."
        )
    return detail[-limit:]


def ytdlp_public_error_message() -> str:
    return YTDLP_MANUAL_UPLOAD_MESSAGE
