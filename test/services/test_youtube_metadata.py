from datetime import datetime, timedelta, timezone

from app.services.youtube_uploader import (
    _clean_upload_description,
    _clean_upload_title,
    _normalize_publish_at,
    _tags_for_upload,
    _upload_privacy_status,
    _video_status_payload,
)


def test_youtube_tags_drop_ai_like_keywords_and_generic_tags():
    tags = _tags_for_upload(
        "O drama financeiro do Fiuk (editado)",
        "O Fiuk desabafou sobre vender carro e guitarra.",
        ["Automotivo", "Carros", "Editado", "Financeiro", "Fiuk", "Questionando"],
    )

    assert "Editado" not in tags
    assert tags[:5] == ["Automotivo", "Carros", "Financeiro", "Fiuk", "Questionando"]


def test_youtube_tags_do_not_add_random_keyword_fallbacks():
    tags = _tags_for_upload(
        "O mico da roupa de frio",
        "A historia de um recifense que sentiu um leve frescor e usou roupas guardadas.",
        ["Historia", "Frio", "Ridicularizado", "Recifense", "Guardadas", "Frescor"],
    )

    assert "Ridicularizado" not in tags
    assert "Guardadas" not in tags
    assert "Frescor" not in tags
    assert tags[:3] == ["Historia", "Frio", "Recifense"]
    assert len(tags) <= 12


def test_youtube_tags_keep_strong_semantic_automotive_tags_only():
    tags = _tags_for_upload(
        "Por que esta Ferrari e unica?",
        "Uma Ferrari 458 Rosso Maranello com motor V8 aspirado.",
        ["Shorts"],
    )

    assert tags[:5] == ["Ferrari 458", "Ferrari", "supercarros", "carro esportivo", "Rosso Maranello"]
    assert "motor aspirado" in tags
    assert "V8" in tags
    assert "automotivo" in tags
    assert len(tags) <= 12


def test_upload_title_and_description_are_naturalized():
    assert _clean_upload_title("O drama financeiro do Fiuk (editado)") == "O drama financeiro do Fiuk"

    description = _clean_upload_description(
        "Este trecho retém o espectador nos primeiros segundos e gera identificação imediata.",
        "O drama financeiro do Fiuk",
    )

    assert description == "Um corte curto sobre o drama financeiro do fiuk."


def test_scheduled_upload_forces_private_status_and_publish_at():
    scheduled = datetime.now(timezone.utc) + timedelta(hours=2)
    publish_at = _normalize_publish_at(scheduled.isoformat())

    privacy_status = _upload_privacy_status("public", publish_at)
    status_payload = _video_status_payload(privacy_status, publish_at)

    assert privacy_status == "private"
    assert status_payload["privacyStatus"] == "private"
    assert status_payload["publishAt"].endswith("Z")
