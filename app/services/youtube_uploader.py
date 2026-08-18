import json
import mimetypes
import os
import re
import shutil
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urlparse

import requests
from dotenv import load_dotenv

from app.services import r2_storage
from app.services.clipper import registry
from app.services.clipper.ingest import job_dir
from app.services.podcast import registry as podcast_registry
from app.services.podcast.ingest import job_dir as podcast_job_dir
from app.utils import utils


AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
THUMBNAIL_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
I18N_LANGUAGES_URL = "https://www.googleapis.com/youtube/v3/i18nLanguages"
I18N_REGIONS_URL = "https://www.googleapis.com/youtube/v3/i18nRegions"
I18N_CACHE_TTL_SECONDS = 24 * 60 * 60
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]
SCOPE = " ".join(SCOPES)


@dataclass
class YouTubeCredentials:
    client_id: str
    client_secret: str
    redirect_uri: str
    frontend_url: str


def oauth_status() -> dict[str, Any]:
    data = {
        "configured": _credentials_available(),
        "authorized": _token_path().is_file(),
        "redirect_uri": _credentials().redirect_uri,
        "scope": SCOPE,
    }
    if data["authorized"]:
        try:
            data["channels"] = list_authorized_channels()
        except RuntimeError as exc:
            data["channel_error"] = str(exc)
    return data


def list_authorized_channels() -> list[dict[str, Any]]:
    access_token = _access_token()
    response = requests.get(
        CHANNELS_URL,
        params={"part": "snippet", "mine": "true", "maxResults": "50"},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, "Falha ao listar canais do YouTube."))
    data = response.json()
    channels = []
    for item in data.get("items", []):
        snippet = item.get("snippet", {})
        thumbnails = snippet.get("thumbnails", {})
        default_thumb = thumbnails.get("default") or {}
        channels.append(
            {
                "id": item.get("id"),
                "title": snippet.get("title"),
                "description": snippet.get("description"),
                "thumbnail": default_thumb.get("url"),
            }
        )
    return channels


def list_i18n_options(hl: str = "pt-BR") -> dict[str, list[dict[str, str]]]:
    cached = _read_i18n_cache()
    if cached:
        return cached

    access_token = _access_token()
    languages = _fetch_i18n_list(
        I18N_LANGUAGES_URL,
        access_token,
        params={"part": "snippet", "hl": hl},
        fallback_message="Falha ao listar idiomas do YouTube.",
    )
    regions = _fetch_i18n_list(
        I18N_REGIONS_URL,
        access_token,
        params={"part": "snippet", "hl": hl},
        fallback_message="Falha ao listar paises do YouTube.",
    )
    data = {"languages": languages, "regions": regions}
    _write_i18n_cache(data)
    return data


def authorization_url(frontend_url: str | None = None) -> str:
    creds = _credentials()
    _require_credentials(creds)
    target_frontend_url = _safe_frontend_url(frontend_url) or creds.frontend_url
    state = utils.get_uuid()
    _write_state(state, {"created_at": time.time(), "frontend_url": target_frontend_url})
    query = urlencode(
        {
            "client_id": creds.client_id,
            "redirect_uri": creds.redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            "prompt": "consent select_account",
            "include_granted_scopes": "true",
            "state": state,
        }
    )
    return f"{AUTH_URL}?{query}"


def handle_oauth_callback(code: str, state: str) -> str:
    creds = _credentials()
    _require_credentials(creds)
    stored_state = _read_state(state)
    if not stored_state:
        raise RuntimeError("Estado OAuth invalido ou expirado.")

    response = requests.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "redirect_uri": creds.redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, "Falha ao autorizar YouTube."))

    token = response.json()
    token["expires_at"] = int(time.time()) + int(token.get("expires_in", 3600)) - 60
    _write_token(token)
    _delete_state(state)
    return str(stored_state.get("frontend_url") or creds.frontend_url)


def upload_clipper_output(
    job_id: str,
    output_id: str,
    title: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    cover_url: str | None = None,
    cover_key: str | None = None,
    privacy_status: str = "private",
    video_language: str = "pt-BR",
    audio_language: str = "pt-BR",
    caption_language: str = "pt-BR",
) -> dict[str, Any]:
    output = _find_clipper_output(job_id, output_id)
    _hydrate_output_metadata(job_id, output)
    video_path = Path(str(output.get("video_path", ""))).resolve()
    _validate_video_path(video_path)

    video_title = (title or output.get("title") or "Short criado pelo Flixo").strip()[:100]
    video_description = (description or _description_from_output(output, video_title)).strip()
    status = privacy_status if privacy_status in {"private", "unlisted", "public"} else "private"
    video_lang = _normalize_language(video_language)
    audio_lang = _normalize_language(audio_language)
    caption_lang = _normalize_language(caption_language)

    access_token = _access_token()
    metadata = {
        "snippet": {
            "title": video_title,
            "description": video_description,
            "categoryId": "22",
            "tags": _tags_for_upload(video_title, video_description, tags),
            "defaultLanguage": video_lang,
            "defaultAudioLanguage": audio_lang,
        },
        "status": {
            "privacyStatus": status,
            "selfDeclaredMadeForKids": False,
        },
    }
    upload_url = _create_resumable_upload(access_token, video_path, metadata)
    youtube_response = _upload_file(access_token, upload_url, video_path)
    video_id = youtube_response.get("id")
    if not video_id:
        raise RuntimeError("YouTube concluiu o upload, mas nao retornou o ID do video.")
    return {
        "output_id": output_id,
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "title": video_title,
        "privacy_status": status,
        "video_language": video_lang,
        "audio_language": audio_lang,
        "caption_language": caption_lang,
    }


def upload_podcast_output(
    job_id: str,
    output_id: str,
    title: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    cover_url: str | None = None,
    cover_key: str | None = None,
    privacy_status: str = "private",
    video_language: str = "pt-BR",
    audio_language: str = "pt-BR",
    caption_language: str = "pt-BR",
) -> dict[str, Any]:
    output = _find_podcast_output(job_id, output_id)
    _hydrate_podcast_output_metadata(job_id, output)
    result = _upload_output(
        output=output,
        video_title=(title or output.get("title") or "Podcast short criado pelo Flixo").strip()[:100],
        video_description=(description or _description_from_output(output, title or output.get("title") or "podcast")).strip(),
        tags=tags,
        cover_url=cover_url,
        cover_key=cover_key,
        privacy_status=privacy_status,
        video_language=video_language,
        audio_language=audio_language,
        caption_language=caption_language,
        task_root="podcast",
    )
    result["output_id"] = output_id
    return result


def _upload_output(
    output: dict[str, Any],
    video_title: str,
    video_description: str,
    tags: list[str] | None,
    cover_url: str | None,
    cover_key: str | None,
    privacy_status: str,
    video_language: str,
    audio_language: str,
    caption_language: str,
    task_root: str,
) -> dict[str, Any]:
    video_path = Path(str(output.get("video_path", ""))).resolve()
    _validate_video_path(video_path, task_root)

    status = privacy_status if privacy_status in {"private", "unlisted", "public"} else "private"
    video_lang = _normalize_language(video_language)
    audio_lang = _normalize_language(audio_language)
    caption_lang = _normalize_language(caption_language)

    access_token = _access_token()
    metadata = {
        "snippet": {
            "title": video_title,
            "description": video_description,
            "categoryId": "22",
            "tags": _tags_for_upload(video_title, video_description, tags),
            "defaultLanguage": video_lang,
            "defaultAudioLanguage": audio_lang,
        },
        "status": {
            "privacyStatus": status,
            "selfDeclaredMadeForKids": False,
        },
    }
    upload_url = _create_resumable_upload(access_token, video_path, metadata)
    youtube_response = _upload_file(access_token, upload_url, video_path)
    video_id = youtube_response.get("id")
    if not video_id:
        raise RuntimeError("YouTube concluiu o upload, mas nao retornou o ID do video.")
    return {
        "output_id": str(output.get("id") or ""),
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "title": video_title,
        "privacy_status": status,
        "video_language": video_lang,
        "audio_language": audio_lang,
        "caption_language": caption_lang,
    }


def upload_clipper_job(
    job_id: str,
    overrides: dict[str, dict[str, Any]] | None = None,
    privacy_status: str = "private",
    cleanup_after_upload: bool = True,
    video_language: str = "pt-BR",
    audio_language: str = "pt-BR",
    caption_language: str = "pt-BR",
) -> dict[str, Any]:
    outputs = _clipper_outputs(job_id)
    if not outputs:
        raise RuntimeError("Nenhum short renderizado encontrado para upload.")

    uploads = []
    output_overrides = overrides or {}
    for output in outputs:
        output_id = str(output.get("id") or "")
        if not output_id:
            raise RuntimeError("Output sem ID encontrado; upload em lote interrompido.")
        custom = output_overrides.get(output_id) or {}
        uploads.append(
            upload_clipper_output(
                job_id=job_id,
                output_id=output_id,
                title=_optional_str(custom.get("title")),
                description=_optional_str(custom.get("description")),
                tags=_normalize_tags(custom.get("tags")),
                cover_url=_optional_str(custom.get("cover_url")),
                cover_key=_optional_str(custom.get("cover_key")),
                privacy_status=privacy_status,
                video_language=video_language,
                audio_language=audio_language,
                caption_language=caption_language,
            )
        )

    cleaned = False
    if cleanup_after_upload:
        _cleanup_clipper_job(job_id)
        cleaned = True

    return {
        "job_id": job_id,
        "uploads": uploads,
        "cleanup": cleaned,
    }


def upload_podcast_job(
    job_id: str,
    overrides: dict[str, dict[str, Any]] | None = None,
    privacy_status: str = "private",
    cleanup_after_upload: bool = True,
    video_language: str = "pt-BR",
    audio_language: str = "pt-BR",
    caption_language: str = "pt-BR",
) -> dict[str, Any]:
    outputs = _podcast_outputs(job_id)
    if not outputs:
        raise RuntimeError("Nenhum short de podcast renderizado encontrado para upload.")

    uploads = []
    output_overrides = overrides or {}
    for output in outputs:
        output_id = str(output.get("id") or "")
        if not output_id:
            raise RuntimeError("Output sem ID encontrado; upload em lote interrompido.")
        custom = output_overrides.get(output_id) or {}
        uploads.append(
            upload_podcast_output(
                job_id=job_id,
                output_id=output_id,
                title=_optional_str(custom.get("title")),
                description=_optional_str(custom.get("description")),
                tags=_normalize_tags(custom.get("tags")),
                cover_url=_optional_str(custom.get("cover_url")),
                cover_key=_optional_str(custom.get("cover_key")),
                privacy_status=privacy_status,
                video_language=video_language,
                audio_language=audio_language,
                caption_language=caption_language,
            )
        )

    _mark_podcast_job_uploaded(job_id, uploads)
    cleaned = False
    if cleanup_after_upload:
        _cleanup_podcast_job(job_id)
        cleaned = True

    return {
        "job_id": job_id,
        "uploads": uploads,
        "cleanup": cleaned,
    }


def _mark_podcast_job_uploaded(job_id: str, uploads: list[dict[str, Any]]) -> None:
    if not podcast_registry.get_job(job_id):
        return
    uploads_by_output = {
        str(upload.get("output_id") or ""): upload
        for upload in uploads
        if upload.get("output_id")
    }

    def apply(job):
        job.status = "done"
        job.current_step = "done"
        job.progress = 100
        for output in job.outputs:
            output_id = str(output.get("id") or "")
            upload = uploads_by_output.get(output_id)
            if not upload:
                continue
            output["youtube_uploaded"] = True
            output["youtube_uploaded_at"] = int(time.time())
            output["youtube_video_id"] = upload.get("video_id")
            output["youtube_url"] = upload.get("url")
            output["history_status"] = "uploaded"
            output["archive_compression_status"] = "queued"

    podcast_registry.update_job(job_id, apply)


def compress_podcast_job_for_history(job_id: str) -> dict[str, Any]:
    job = podcast_registry.get_job(job_id)
    if not job:
        return {"job_id": job_id, "compressed": 0, "skipped": 0, "errors": ["job not found"]}
    if not r2_storage.configured():
        _mark_archive_compression(job_id, status="skipped", error="R2 nao configurado.")
        return {"job_id": job_id, "compressed": 0, "skipped": len(job.outputs or []), "errors": ["R2 not configured"]}

    compressed = 0
    skipped = 0
    errors = []
    updated_outputs = []
    with tempfile.TemporaryDirectory(prefix=f"flixo-archive-{job_id}-") as temp_dir:
        for output in job.outputs or []:
            updated = dict(output)
            output_id = str(updated.get("id") or "")
            video_key = str(updated.get("video_key") or updated.get("r2_video_key") or "").strip()
            if not output_id or not video_key:
                updated["archive_compression_status"] = "skipped"
                updated_outputs.append(updated)
                skipped += 1
                continue
            if updated.get("r2_archive_compressed"):
                updated_outputs.append(updated)
                skipped += 1
                continue
            try:
                source_path = _archive_source_path(updated, video_key, temp_dir)
                if not source_path:
                    raise RuntimeError("Video do historico nao encontrado localmente nem no R2.")
                before_size = source_path.stat().st_size
                r2_storage.replace_with_archive_compressed(source_path)
                after_size = source_path.stat().st_size
                if not r2_storage.upload_file(source_path, video_key, "video/mp4"):
                    raise RuntimeError("Falha ao reenviar video comprimido para o R2.")
                updated["video_key"] = video_key
                updated["r2_video_key"] = video_key
                updated["video_url"] = r2_storage.public_url(video_key)
                updated["r2_archive_compressed"] = True
                updated["r2_archive_original_size"] = before_size
                updated["r2_archive_size"] = after_size
                updated["r2_archive_saved_bytes"] = max(0, before_size - after_size)
                updated["archive_compression_status"] = "done"
                updated["archive_compressed_at"] = int(time.time())
                updated.pop("archive_compression_error", None)
                compressed += 1
            except Exception as exc:
                updated["archive_compression_status"] = "failed"
                updated["archive_compression_error"] = str(exc)
                errors.append(f"{output_id}: {exc}")
            updated_outputs.append(updated)

    def apply(job):
        job.outputs = updated_outputs

    podcast_registry.update_job(job_id, apply)
    return {"job_id": job_id, "compressed": compressed, "skipped": skipped, "errors": errors}


def _mark_archive_compression(job_id: str, status: str, error: str | None = None) -> None:
    if not podcast_registry.get_job(job_id):
        return

    def apply(job):
        for output in job.outputs:
            output["archive_compression_status"] = status
            if error:
                output["archive_compression_error"] = error

    podcast_registry.update_job(job_id, apply)


def _archive_source_path(output: dict[str, Any], video_key: str, temp_dir: str) -> Path | None:
    local_path = Path(str(output.get("video_path") or ""))
    if local_path.is_file():
        target = Path(temp_dir) / f"{str(output.get('id') or utils.get_uuid())}.mp4"
        shutil.copy2(local_path, target)
        return target

    target = Path(temp_dir) / f"{Path(video_key).stem}.mp4"
    if r2_storage.download_to_file(video_key, target):
        return target
    return None


def update_video_metadata(
    video_id: str,
    title: str,
    description: str,
    privacy_status: str = "private",
    tags: list[str] | None = None,
    video_language: str = "pt-BR",
    audio_language: str = "pt-BR",
) -> dict[str, Any]:
    access_token = _access_token()
    metadata = {
        "id": video_id,
        "snippet": {
            "title": title.strip()[:100],
            "description": description.strip(),
            "categoryId": "22",
            "tags": _tags_for_upload(title, description, tags),
            "defaultLanguage": _normalize_language(video_language),
            "defaultAudioLanguage": _normalize_language(audio_language),
        },
        "status": {
            "privacyStatus": privacy_status if privacy_status in {"private", "unlisted", "public"} else "private",
            "selfDeclaredMadeForKids": False,
        },
    }
    response = requests.put(
        "https://www.googleapis.com/youtube/v3/videos?part=snippet,status",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        },
        json=metadata,
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, "Falha ao atualizar metadata do YouTube."))
    return response.json()


def _normalize_language(value: str | None, fallback: str = "pt-BR") -> str:
    language = (value or fallback).strip()
    if re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}", language):
        parts = language.split("-")
        normalized = [parts[0].lower()]
        normalized.extend(part.upper() if len(part) == 2 else part for part in parts[1:])
        return "-".join(normalized)
    return fallback


def _credentials() -> YouTubeCredentials:
    _load_env()
    return YouTubeCredentials(
        client_id=(
            os.getenv("YOUTUBE_CLIENT_ID")
            or os.getenv("GOOGLE_OAUTH_CLIENT_ID")
            or ""
        ).strip(),
        client_secret=(
            os.getenv("YOUTUBE_CLIENT_SECRET")
            or os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
            or ""
        ).strip(),
        redirect_uri=os.getenv(
            "YOUTUBE_REDIRECT_URI",
            "http://127.0.0.1:8080/api/v1/youtube/oauth/callback",
        ).strip(),
        frontend_url=os.getenv(
            "YOUTUBE_FRONTEND_URL",
            "http://127.0.0.1:8788/clipper.html",
        ).strip(),
    )


def _safe_frontend_url(value: str | None) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    if not (url.startswith("http://127.0.0.1:") or url.startswith("http://localhost:") or url.startswith("https://")):
        return ""
    return url[:500]


def _default_tags(title: str, description: str) -> list[str]:
    text = _tag_text(title, description)
    tags: list[str] = []
    _append_matching_tags(text, tags)
    if len(tags) < 6:
        tags.extend(_fallback_keyword_tags(text))
    return list(dict.fromkeys(tags))[:15]


def _tags_for_upload(title: str, description: str, value: Any) -> list[str]:
    tags = _normalize_tags(value)
    suggested = _default_tags(title, description)
    existing = {tag.lower() for tag in tags}
    for tag in suggested:
        if tag.lower() not in existing:
            tags.append(tag)
            existing.add(tag.lower())
    return tags[:15]


def _normalize_tags(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        raw_tags = value.replace(",", " ").split()
    elif isinstance(value, list):
        raw_tags = [str(item) for item in value]
    else:
        return []
    tags = []
    for item in raw_tags:
        clean = item.strip().lstrip("#")
        if not clean:
            continue
        tags.append(clean[:60])
    return list(dict.fromkeys(tags))[:15]


def _tag_text(*values: str) -> str:
    text = " ".join(str(value or "") for value in values)
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower()


def _append_matching_tags(text: str, tags: list[str]) -> None:
    def add(*items: str) -> None:
        for item in items:
            if item and item not in tags:
                tags.append(item)

    if re.search(r"\bferrari\s*458\b", text):
        add("Ferrari 458", "Ferrari", "supercarros", "carro esportivo")
    elif "ferrari" in text:
        add("Ferrari", "supercarros")
    if "rosso maranello" in text:
        add("Rosso Maranello")
    if "aspirad" in text:
        add("motor aspirado")
    if re.search(r"\bv8\b", text):
        add("V8")
    if "rolls royce" in text or "rolls-royce" in text:
        add("Rolls Royce", "carros de luxo")
    if "spirit of ecstasy" in text:
        add("Spirit of Ecstasy")
    if "honda nsx" in text or re.search(r"\bnsx\b", text):
        add("Honda NSX", "JDM", "carros japoneses")
    if "nissan" in text or "gtr" in text or "skyline" in text:
        add("Nissan GTR", "JDM")
    if "need for speed" in text:
        add("Need for Speed", "carros customizados")
    if "drift" in text:
        add("drift", "carros preparados")
    if "rally" in text:
        add("rally", "carros preparados")
    if "biturbo" in text or "bi turbo" in text:
        add("biturbo", "carros preparados")
    if "turbo" in text:
        add("turbo", "carros preparados")
    if "600 cavalos" in text or "cavalos de potencia" in text:
        add("carros preparados")
    if "radiador" in text:
        add("radiador", "mecanica automotiva")
    if "oleo" in text:
        add("oleo do motor", "mecanica automotiva")
    if "eletrico" in text:
        add("carro eletrico")
    if "roda" in text:
        add("rodas")
    if "escapamento" in text:
        add("escapamento")
    if "pane" in text:
        add("pane no carro")
    if "oficina" in text or "mecanica" in text:
        add("oficina", "mecanica automotiva")
    if "painel" in text or "digital" in text:
        add("tecnologia automotiva")
    if "teto estrelado" in text or "ceu estrelado" in text:
        add("carros de luxo")
    if "motiv" in text or "crescer" in text or "sonho" in text:
        add("motivacao")
    if "dica" in text or "aprend" in text:
        add("dicas")
    if _has_automotive_context(text):
        add("carros", "automotivo")


def _has_automotive_context(text: str) -> bool:
    terms = (
        "carro",
        "ferrari",
        "motor",
        "oficina",
        "roda",
        "turbo",
        "honda",
        "nissan",
        "rolls",
        "drift",
        "rally",
        "radiador",
        "cambio",
        "esportivo",
    )
    return any(term in text for term in terms)


def _fallback_keyword_tags(text: str) -> list[str]:
    tags: list[str] = []
    mapping = (
        ("pandemia", "historia"),
        ("peste negra", "Peste Negra"),
        ("medieval", "Idade Media"),
        ("armadura", "armaduras"),
        ("gato", "gatos"),
        ("cachorro", "cachorros"),
        ("curiosidade", "curiosidades"),
        ("motivacao", "motivacao"),
        ("empreend", "empreendedorismo"),
        ("negocio", "negocios"),
        ("marketing", "marketing digital"),
        ("ferrari", "Ferrari"),
        ("oficina", "oficina"),
        ("mecanica", "mecanica automotiva"),
    )
    for term, tag in mapping:
        if term in text and tag not in tags:
            tags.append(tag)
    for tag in _keyword_tags_from_text(text):
        if tag not in tags:
            tags.append(tag)
    return tags


def _keyword_tags_from_text(text: str) -> list[str]:
    stopwords = {
        "sobre",
        "para",
        "porque",
        "como",
        "esse",
        "essa",
        "isso",
        "aquele",
        "aquela",
        "muito",
        "mais",
        "menos",
        "quando",
        "onde",
        "voce",
        "eles",
        "elas",
        "dele",
        "dela",
        "nesse",
        "nessa",
        "video",
        "clip",
        "clipe",
        "corte",
        "momento",
        "trecho",
        "fala",
        "falando",
        "pessoa",
        "pessoas",
    }
    words = re.findall(r"[a-z0-9]{4,}", text)
    counts: dict[str, int] = {}
    for word in words:
        if word in stopwords or word.isdigit():
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))
    return [word for word, _ in ranked[:6]]


def _optional_str(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _description_from_output(output: dict[str, Any], title: str) -> str:
    public_description = str(output.get("public_description") or "").strip()
    summary = str(output.get("summary") or "").strip()
    hook = str(output.get("hook") or "").strip()
    transcript_text = _transcript_description(output)
    parts = []
    if public_description and not _looks_editorial(public_description):
        parts.append(public_description)
    elif summary and not _looks_editorial(summary):
        parts.append(summary)
    elif transcript_text:
        parts.append(transcript_text)
    elif hook and not _looks_editorial(hook) and len(hook) >= 24:
        parts.append(f"Nesse corte, {hook[:1].lower() + hook[1:]}")
    else:
        parts.append(f"Um momento curto sobre {title.lower()}.")
    return "\n\n".join(parts)


def _looks_editorial(text: str) -> bool:
    normalized = text.lower()
    editorial_terms = (
        "retém",
        "retencao",
        "retenção",
        "espectador",
        "hook",
        "identificação imediata",
        "dor emocional",
        "criador",
        "criadores",
        "criando uma identificação",
        "gera confiança",
        "gera autoridade",
        "valor percebido",
        "alto valor",
        "chamada motivacional",
        "primeiros segundos",
        "reten",
        "ranking",
        "algoritmo",
        "payoff",
    )
    return any(term in normalized for term in editorial_terms)


def _transcript_description(output: dict[str, Any]) -> str:
    subtitle_path = str(output.get("subtitle_path") or "").strip()
    if not subtitle_path or not os.path.isfile(subtitle_path):
        return ""
    try:
        from app.services.clipper.transcriber import parse_srt

        text = " ".join(segment.text for segment in parse_srt(subtitle_path))
    except Exception:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    if len(text) > 260:
        text = text[:257].rsplit(" ", 1)[0].rstrip(".,;:") + "..."
    return text


def _load_env() -> None:
    root = Path(utils.root_dir())
    for env_file in (root.parent / ".env", root / ".env"):
        if env_file.is_file():
            load_dotenv(env_file, override=False)


def _credentials_available() -> bool:
    creds = _credentials()
    return bool(creds.client_id and creds.client_secret and creds.redirect_uri)


def _require_credentials(creds: YouTubeCredentials) -> None:
    if not creds.client_id or not creds.client_secret:
        raise RuntimeError("Configure YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no .env.")


def _youtube_dir() -> Path:
    path = Path(utils.storage_dir("youtube", create=True))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _token_path() -> Path:
    return _youtube_dir() / "oauth_token.json"


def _i18n_cache_path() -> Path:
    return _youtube_dir() / "i18n_options.json"


def _state_path(state: str) -> Path:
    safe_state = "".join(ch for ch in state if ch.isalnum() or ch == "-")
    return _youtube_dir() / f"oauth_state_{safe_state}.json"


def _write_state(state: str, data: dict[str, Any]) -> None:
    with _state_path(state).open("w", encoding="utf-8") as file:
        json.dump(data, file)


def _read_state(state: str) -> dict[str, Any] | None:
    path = _state_path(state)
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as file:
        data = json.load(file)
    if time.time() - float(data.get("created_at", 0)) > 600:
        _delete_state(state)
        return None
    return data


def _delete_state(state: str) -> None:
    path = _state_path(state)
    if path.is_file():
        path.unlink()


def _write_token(token: dict[str, Any]) -> None:
    with _token_path().open("w", encoding="utf-8") as file:
        json.dump(token, file, indent=2)


def _read_token() -> dict[str, Any]:
    path = _token_path()
    if not path.is_file():
        raise RuntimeError("YouTube ainda nao foi autorizado. Clique em Conectar YouTube.")
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def _read_i18n_cache() -> dict[str, list[dict[str, str]]] | None:
    path = _i18n_cache_path()
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return None

    if time.time() - float(data.get("created_at", 0)) > I18N_CACHE_TTL_SECONDS:
        return None
    return {
        "languages": list(data.get("languages") or []),
        "regions": list(data.get("regions") or []),
    }


def _write_i18n_cache(data: dict[str, list[dict[str, str]]]) -> None:
    payload = {
        **data,
        "created_at": time.time(),
    }
    with _i18n_cache_path().open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def _fetch_i18n_list(
    url: str,
    access_token: str,
    params: dict[str, str],
    fallback_message: str,
) -> list[dict[str, str]]:
    response = requests.get(
        url,
        params=params,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, fallback_message))

    options = []
    for item in response.json().get("items", []):
        snippet = item.get("snippet", {}) or {}
        code = str(snippet.get("hl") or snippet.get("gl") or item.get("id") or "").strip()
        name = str(snippet.get("name") or code).strip()
        if code and name:
            options.append({"code": code, "name": name})
    return sorted(options, key=lambda option: option["name"].casefold())


def _access_token() -> str:
    token = _read_token()
    if int(token.get("expires_at", 0)) > int(time.time()) and token.get("access_token"):
        return str(token["access_token"])
    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("Refresh token ausente. Refaça a autorizacao do YouTube.")

    creds = _credentials()
    response = requests.post(
        TOKEN_URL,
        data={
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, "Falha ao renovar token do YouTube."))
    refreshed = response.json()
    token.update(refreshed)
    token["refresh_token"] = refresh_token
    token["expires_at"] = int(time.time()) + int(refreshed.get("expires_in", 3600)) - 60
    _write_token(token)
    return str(token["access_token"])


def _create_resumable_upload(
    access_token: str,
    video_path: Path,
    metadata: dict[str, Any],
) -> str:
    mime_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
    response = requests.post(
        f"{UPLOAD_URL}?uploadType=resumable&part=snippet,status",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": mime_type,
            "X-Upload-Content-Length": str(video_path.stat().st_size),
        },
        json=metadata,
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, "Falha ao iniciar upload no YouTube."))
    upload_url = response.headers.get("Location")
    if not upload_url:
        raise RuntimeError("YouTube nao retornou a URL de upload resumivel.")
    return upload_url


def _upload_file(access_token: str, upload_url: str, video_path: Path) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
    with video_path.open("rb") as file:
        response = requests.put(
            upload_url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": mime_type,
                "Content-Length": str(video_path.stat().st_size),
            },
            data=file,
            timeout=600,
        )
    if response.status_code >= 400:
        raise RuntimeError(_google_error(response, "Falha ao enviar video ao YouTube."))
    return response.json()


def _try_upload_thumbnail(
    access_token: str,
    video_id: str,
    cover_url: str | None,
    cover_key: str | None = None,
) -> tuple[dict[str, Any] | None, str]:
    try:
        return _upload_thumbnail(access_token, video_id, cover_url, cover_key), ""
    except RuntimeError as exc:
        return None, str(exc)


def _upload_thumbnail(
    access_token: str,
    video_id: str,
    cover_url: str | None,
    cover_key: str | None = None,
) -> dict[str, Any] | None:
    resolved_key = _safe_r2_key(cover_key) or _cover_key_from_asset_url(cover_url)
    thumbnail_path = (
        _thumbnail_path_from_key(resolved_key)
        or _download_thumbnail_from_key(resolved_key)
        or _thumbnail_path_from_url(cover_url)
        or _download_thumbnail_from_url(cover_url)
    )
    if not thumbnail_path:
        raise RuntimeError("Video enviado, mas a miniatura selecionada nao foi encontrada para envio.")
    temporary = Path(tempfile.gettempdir()).resolve() in thumbnail_path.resolve().parents
    try:
        mime_type = mimetypes.guess_type(thumbnail_path.name)[0] or "image/jpeg"
        with thumbnail_path.open("rb") as file:
            response = requests.post(
                THUMBNAIL_UPLOAD_URL,
                params={"videoId": video_id},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": mime_type,
                    "Content-Length": str(thumbnail_path.stat().st_size),
                },
                data=file,
                timeout=120,
            )
        if response.status_code >= 400:
            raise RuntimeError(_google_error(response, "Video enviado, mas falhou ao aplicar capa."))
        payload = response.json()
        thumbnails = {}
        for item in payload.get("items", []):
            if isinstance(item, dict):
                thumbnails.update(item)
        return {
            "etag": str(payload.get("etag") or ""),
            "thumbnails": thumbnails,
        }
    finally:
        if temporary:
            thumbnail_path.unlink(missing_ok=True)


def _cover_key_from_asset_url(cover_url: str | None) -> str | None:
    value = str(cover_url or "").strip()
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.path != "/api/assets":
        return None
    key = parse_qs(parsed.query).get("key", [""])[0]
    return _safe_r2_key(unquote(key))


def _safe_r2_key(value: str | None) -> str | None:
    key = str(value or "").strip()
    if not key or key.startswith("/") or "\\" in key or ".." in key:
        return None
    if not key.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        return None
    return key


def _thumbnail_path_from_key(key: str | None) -> Path | None:
    if not key:
        return None
    tasks_root = (Path(utils.root_dir()).resolve() / "storage" / "tasks").resolve()
    path = (tasks_root / key).resolve()
    if path.is_file() and path.is_relative_to(tasks_root):
        return path
    return None


def _download_thumbnail_from_key(key: str | None) -> Path | None:
    if not key:
        return None
    suffix = Path(key).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"
    fd, path = tempfile.mkstemp(prefix="flixo-youtube-cover-", suffix=suffix)
    os.close(fd)
    target = Path(path)
    if r2_storage.download_to_file(key, target):
        return target
    target.unlink(missing_ok=True)
    return None


def _thumbnail_path_from_url(cover_url: str | None) -> Path | None:
    value = str(cover_url or "").strip()
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return None
    root = Path(utils.root_dir()).resolve()
    tasks_root = (root / "storage" / "tasks").resolve()
    if value.startswith("/tasks/"):
        path = (tasks_root / value.removeprefix("/tasks/")).resolve()
    else:
        path = Path(value).resolve()
    if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        return None
    if not path.is_relative_to(tasks_root):
        raise RuntimeError("Caminho de capa fora da pasta de tasks.")
    return path


def _download_thumbnail_from_url(cover_url: str | None) -> Path | None:
    value = str(cover_url or "").strip()
    if not (value.startswith("http://") or value.startswith("https://")):
        return None
    response = requests.get(value, timeout=60)
    if response.status_code >= 400:
        raise RuntimeError(f"Video enviado, mas nao foi possivel baixar a capa selecionada ({response.status_code}).")
    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise RuntimeError("Video enviado, mas a capa selecionada nao parece ser uma imagem valida.")
    suffix = {
        "image/png": ".png",
        "image/webp": ".webp",
    }.get(content_type, ".jpg")
    fd, path = tempfile.mkstemp(prefix="flixo-youtube-cover-", suffix=suffix)
    with os.fdopen(fd, "wb") as file:
        file.write(response.content)
    return Path(path)


def _find_clipper_output(job_id: str, output_id: str) -> dict[str, Any]:
    for output in _clipper_outputs(job_id):
        if output.get("id") == output_id:
            return output
    raise RuntimeError("Short renderizado nao encontrado para upload.")


def _find_podcast_output(job_id: str, output_id: str) -> dict[str, Any]:
    for output in _podcast_outputs(job_id):
        if output.get("id") == output_id:
            return output
    raise RuntimeError("Short de podcast renderizado nao encontrado para upload.")


def _clipper_outputs(job_id: str) -> list[dict[str, Any]]:
    job = registry.get_job(job_id)
    outputs = job.outputs if job else _metadata_outputs(job_id)
    return [dict(output) for output in outputs]


def _podcast_outputs(job_id: str) -> list[dict[str, Any]]:
    job = podcast_registry.get_job(job_id)
    outputs = job.outputs if job else _metadata_outputs(job_id, "podcast")
    return [dict(output) for output in outputs]


def _hydrate_output_metadata(job_id: str, output: dict[str, Any]) -> None:
    if output.get("summary") and output.get("hook"):
        return
    path = Path(job_dir(job_id)) / "metadata.json"
    if not path.is_file():
        return
    with path.open(encoding="utf-8") as file:
        data = json.load(file)
    candidates = data.get("candidates") or []
    candidate = next((item for item in candidates if item.get("id") == output.get("id")), None)
    if not candidate:
        return
    for key in ("summary", "hook"):
        if not output.get(key) and candidate.get(key):
            output[key] = candidate[key]


def _hydrate_podcast_output_metadata(job_id: str, output: dict[str, Any]) -> None:
    if output.get("summary") and output.get("hook"):
        return
    path = Path(podcast_job_dir(job_id)) / "metadata.json"
    if not path.is_file():
        return
    with path.open(encoding="utf-8") as file:
        data = json.load(file)
    candidates = data.get("candidates") or []
    candidate = next((item for item in candidates if item.get("id") == output.get("id")), None)
    if not candidate:
        return
    for key in ("summary", "hook", "reason"):
        if not output.get(key) and candidate.get(key):
            output[key] = candidate[key]


def _metadata_outputs(job_id: str, task_root: str = "clipper") -> list[dict[str, Any]]:
    base_dir = podcast_job_dir(job_id) if task_root == "podcast" else job_dir(job_id)
    path = Path(base_dir) / "metadata.json"
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as file:
        data = json.load(file)
    return list(data.get("outputs") or [])


def _validate_video_path(video_path: Path, task_root: str = "clipper") -> None:
    tasks_root = Path(utils.task_dir(task_root)).resolve()
    if not video_path.is_file():
        raise RuntimeError("Arquivo MP4 nao encontrado no storage local.")
    if tasks_root not in video_path.parents:
        raise RuntimeError("Caminho de video invalido para upload.")


def _cleanup_clipper_job(job_id: str) -> None:
    path = Path(job_dir(job_id)).resolve()
    tasks_root = Path(utils.task_dir("clipper")).resolve()
    if not path.exists():
        registry.delete_job(job_id)
        return
    if path == tasks_root or tasks_root not in path.parents:
        raise RuntimeError("Caminho de limpeza invalido para job do clipper.")
    shutil.rmtree(path)
    registry.delete_job(job_id)


def _cleanup_podcast_job(job_id: str) -> None:
    path = Path(podcast_job_dir(job_id)).resolve()
    tasks_root = Path(utils.task_dir("podcast")).resolve()
    if not path.exists():
        podcast_registry.delete_job(job_id)
        return
    if path == tasks_root or tasks_root not in path.parents:
        raise RuntimeError("Caminho de limpeza invalido para job do podcast.")
    shutil.rmtree(path)
    podcast_registry.delete_job(job_id)


def _google_error(response: requests.Response, fallback: str) -> str:
    try:
        payload = response.json()
        detail = payload.get("error", {})
        if isinstance(detail, dict):
            message = detail.get("message") or detail.get("error_description")
        else:
            message = detail
        return f"{fallback} {message or response.text}".strip()
    except Exception:
        return f"{fallback} {response.text}".strip()
