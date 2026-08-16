import hashlib
import hmac
import mimetypes
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests
from loguru import logger

from app.utils import utils


def configured() -> bool:
    return all(
        os.getenv(name)
        for name in (
            "CLOUDFLARE_ACCOUNT_ID",
            "R2_BUCKET",
            "R2_BUCKET_ACCESS_KEY_ID",
            "R2_BUCKET_SECRET_ACCESS_KEY",
        )
    )


def public_url(key: str) -> str:
    base = os.getenv("R2_PUBLIC_BASE_URL", "").strip()
    if base:
        return f"{base.rstrip('/')}/{key.lstrip('/')}"
    return f"/api/assets?key={quote(key, safe='')}"


def content_type_for(path: str | Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def upload_file(path: str | Path, key: str, content_type: str | None = None) -> bool:
    if not configured():
        return False
    file_path = Path(path)
    if not file_path.is_file():
        return False
    body = file_path.read_bytes()
    response = _signed_put(
        key=key,
        body=body,
        content_type=content_type or content_type_for(file_path),
    )
    if response.ok:
        return True
    logger.warning(f"R2 upload failed: key={key}, status={response.status_code}, body={response.text[:300]}")
    return False


def download_to_file(key: str, path: str | Path) -> bool:
    if not configured():
        return False
    response = _signed_get(key)
    if not response.ok:
        logger.warning(f"R2 download failed: key={key}, status={response.status_code}, body={response.text[:300]}")
        return False
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    return True


def compress_mp4_for_storage(input_path: str | Path) -> Path:
    return _compress_mp4(
        input_path=input_path,
        max_width=int(os.getenv("R2_VIDEO_MAX_WIDTH", "1080")),
        crf=os.getenv("R2_VIDEO_CRF", "28"),
        audio_bitrate=os.getenv("R2_AUDIO_BITRATE", "96k"),
        prefix="storage",
    )


def compress_mp4_for_archive(input_path: str | Path) -> Path:
    return _compress_mp4(
        input_path=input_path,
        max_width=int(os.getenv("R2_ARCHIVE_VIDEO_MAX_WIDTH", "720")),
        crf=os.getenv("R2_ARCHIVE_VIDEO_CRF", "32"),
        audio_bitrate=os.getenv("R2_ARCHIVE_AUDIO_BITRATE", "64k"),
        prefix="archive",
    )


def _compress_mp4(
    input_path: str | Path,
    max_width: int,
    crf: str,
    audio_bitrate: str,
    prefix: str,
) -> Path:
    source = Path(input_path)
    if not source.is_file():
        raise FileNotFoundError(str(source))

    temp = tempfile.NamedTemporaryFile(
        suffix=".compressed.mp4",
        prefix=f"{source.stem}-{prefix}-",
        dir=str(source.parent),
        delete=False,
    )
    temp_path = Path(temp.name)
    temp.close()

    command = [
        utils.get_ffmpeg_binary(),
        "-y",
        "-i",
        str(source),
        "-vf",
        f"scale='min({max_width},iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        crf,
        "-c:a",
        "aac",
        "-b:a",
        audio_bitrate,
        "-movflags",
        "+faststart",
        str(temp_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        temp_path.unlink(missing_ok=True)
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Falha ao comprimir video para R2: {detail[-900:]}")

    if temp_path.stat().st_size < source.stat().st_size:
        return temp_path
    temp_path.unlink(missing_ok=True)
    return source


def replace_with_compressed(input_path: str | Path) -> Path:
    source = Path(input_path)
    compressed = compress_mp4_for_storage(source)
    if compressed == source:
        return source
    os.replace(compressed, source)
    return source


def replace_with_archive_compressed(input_path: str | Path) -> Path:
    source = Path(input_path)
    compressed = compress_mp4_for_archive(source)
    if compressed == source:
        return source
    os.replace(compressed, source)
    return source


def _signed_get(key: str) -> requests.Response:
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    bucket = os.environ["R2_BUCKET"]
    access_key_id = os.environ["R2_BUCKET_ACCESS_KEY_ID"]
    secret_access_key = os.environ["R2_BUCKET_SECRET_ACCESS_KEY"]
    host = f"{account_id}.r2.cloudflarestorage.com"
    canonical_uri = f"/{bucket}/{_encode_key(key)}"
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = "UNSIGNED-PAYLOAD"

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{name}:{headers[name].strip()}\n" for name in sorted(headers))
    canonical_request = "\n".join(
        [
            "GET",
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    credential_scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _signature_key(secret_access_key, date_stamp)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    return requests.get(
        f"https://{host}{canonical_uri}",
        headers={
            "Authorization": authorization,
            "X-Amz-Content-Sha256": payload_hash,
            "X-Amz-Date": amz_date,
        },
        timeout=120,
    )


def _signed_put(key: str, body: bytes, content_type: str) -> requests.Response:
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    bucket = os.environ["R2_BUCKET"]
    access_key_id = os.environ["R2_BUCKET_ACCESS_KEY_ID"]
    secret_access_key = os.environ["R2_BUCKET_SECRET_ACCESS_KEY"]
    host = f"{account_id}.r2.cloudflarestorage.com"
    canonical_uri = f"/{bucket}/{_encode_key(key)}"
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {
        "content-type": content_type,
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{name}:{headers[name].strip()}\n" for name in sorted(headers))
    canonical_request = "\n".join(
        [
            "PUT",
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    credential_scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _signature_key(secret_access_key, date_stamp)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    return requests.put(
        f"https://{host}{canonical_uri}",
        data=body,
        headers={
            "Authorization": authorization,
            "Content-Type": content_type,
            "X-Amz-Content-Sha256": payload_hash,
            "X-Amz-Date": amz_date,
        },
        timeout=120,
    )


def _signature_key(secret_access_key: str, date_stamp: str) -> bytes:
    date_key = _hmac(f"AWS4{secret_access_key}".encode("utf-8"), date_stamp)
    region_key = _hmac(date_key, "auto")
    service_key = _hmac(region_key, "s3")
    return _hmac(service_key, "aws4_request")


def _hmac(key: bytes, value: str) -> bytes:
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).digest()


def _encode_key(key: str) -> str:
    return "/".join(quote(part, safe="") for part in key.lstrip("/").split("/"))
