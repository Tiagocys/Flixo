from app.services.clipper.models import TranscriptSegment


def transcript_blocks(
    segments: list[TranscriptSegment],
    max_chars: int = 16000,
) -> list[list[TranscriptSegment]]:
    blocks: list[list[TranscriptSegment]] = []
    current: list[TranscriptSegment] = []
    current_chars = 0
    for segment in segments:
        segment_chars = len(segment.text) + 32
        if current and current_chars + segment_chars > max_chars:
            blocks.append(current)
            current = []
            current_chars = 0
        current.append(segment)
        current_chars += segment_chars
    if current:
        blocks.append(current)
    return blocks
