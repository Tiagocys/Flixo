from loguru import logger

from app.services.clipper import registry
from app.services.clipper.analyzer import analyze_transcript
from app.services.clipper.clip_selector import render_selected_clips
from app.services.clipper.ingest import ingest_url, job_dir
from app.services.clipper.metadata import write_job_metadata


def analyze_job(job_id: str, source_url: str | None = None) -> None:
    try:
        output_dir = job_dir(job_id)
        job = registry.get_job(job_id)
        if not job:
            return

        def ingesting(current):
            current.status = "running"
            current.current_step = "ingesting"
            current.progress = 10

        registry.update_job(job_id, ingesting)
        source_file = job.source_file
        if source_url:
            source_file = ingest_url(source_url, output_dir)

        def transcribing(current):
            current.source_file = source_file
            current.current_step = "transcribing"
            current.progress = 35

        registry.update_job(job_id, transcribing)

        from app.services.clipper.transcriber import transcribe_video

        def update_transcription_progress(_start, end, _text, duration):
            if not duration:
                return
            percent = max(0.0, min(1.0, float(end) / float(duration)))

            def apply(current):
                if current.current_step == "transcribing":
                    current.progress = max(current.progress, 35 + int(percent * 30))

            registry.update_job(job_id, apply)

        transcript, _ = transcribe_video(
            source_file,
            output_dir,
            progress_callback=update_transcription_progress,
        )

        def analyzing(current):
            current.transcript = transcript
            current.current_step = "analyzing"
            current.progress = 70

        registry.update_job(job_id, analyzing)
        candidates = analyze_transcript(transcript)

        def ready(current):
            current.candidates = candidates
            current.status = "ready"
            current.current_step = "ready"
            current.progress = 100
            current.metadata_path = write_job_metadata(current, output_dir)

        registry.update_job(job_id, ready)
    except Exception as error:
        logger.exception(f"clipper analyze job failed: {job_id}")
        registry.set_failed(job_id, str(error))


def render_job(job_id: str, selected_ids: list[str], burn_subtitles: bool = True) -> None:
    try:
        job = registry.get_job(job_id)
        if not job or not job.source_file:
            raise RuntimeError("Job de clipper nao encontrado ou sem video de origem.")

        output_dir = job_dir(job_id)

        def rendering(current):
            current.status = "rendering"
            current.current_step = "rendering"
            current.progress = 15

        registry.update_job(job_id, rendering)
        outputs = render_selected_clips(
            source_video=job.source_file,
            segments=job.transcript,
            candidates=job.candidates,
            selected_ids=selected_ids,
            output_dir=output_dir,
            burn_subtitles=burn_subtitles,
        )
        if not outputs:
            raise RuntimeError("Nenhum corte valido foi selecionado para renderizacao.")

        def done(current):
            current.outputs = outputs
            current.status = "done"
            current.current_step = "done"
            current.progress = 100
            current.metadata_path = write_job_metadata(current, output_dir)

        registry.update_job(job_id, done)
    except Exception as error:
        logger.exception(f"clipper render job failed: {job_id}")
        registry.set_failed(job_id, str(error))
