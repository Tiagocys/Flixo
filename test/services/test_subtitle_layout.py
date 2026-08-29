from app.services.clipper.models import TranscriptSegment
from app.services.clipper.subtitle_layout import format_subtitle_segments
from app.services.podcast.renderer import _subtitle_force_style


def test_word_subtitle_style_splits_each_word_within_original_time():
    segments = [TranscriptSegment(start=1.0, end=2.0, text="uma palavra por vez")]

    words = format_subtitle_segments(segments, "word")

    assert [item.text for item in words] == ["uma", "palavra", "por", "vez"]
    assert words[0].start == 1.0
    assert words[-1].end == 2.0
    assert all(item.end > item.start for item in words)


def test_word_subtitle_style_wraps_long_words_in_two_lines():
    segments = [TranscriptSegment(start=0.0, end=1.0, text="Paralelepípedo")]

    words = format_subtitle_segments(segments, "word")

    assert len(words) == 1
    assert words[0].text.count("\n") == 1
    assert words[0].text.endswith("pípedo")
    assert "-" in words[0].text.split("\n", 1)[0]


def test_word_subtitle_style_applies_configured_colors():
    style = _subtitle_force_style("word", "yellow", "white")

    assert "PrimaryColour=&H0000FFFF" in style
    assert "OutlineColour=&H00FFFFFF" in style
