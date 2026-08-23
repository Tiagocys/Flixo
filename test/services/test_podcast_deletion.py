import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.controllers.v1 import podcast as podcast_controller
from app.models.exception import HttpException
from app.services import clipper_database
from app.services.clipper.models import ClipperJob
from app.services.podcast import registry


class TestPodcastProjectDeletion(unittest.TestCase):
    def test_owner_can_delete_terminal_project(self):
        job = ClipperJob(id="job-1", status="done", current_step="done", user_id="user-1")
        with (
            patch.object(registry, "get_job", return_value=job),
            patch.object(registry, "_delete_job_assets") as delete_assets,
            patch.object(registry, "delete_job", return_value=True) as delete_record,
        ):
            deleted_id = registry.delete_job_with_assets(job.id, "user-1")

        self.assertEqual(deleted_id, job.id)
        delete_assets.assert_called_once_with(job)
        delete_record.assert_called_once_with(job.id, user_id="user-1")

    def test_non_owner_and_legacy_project_are_hidden(self):
        for owner_id in ("another-user", None):
            with self.subTest(owner_id=owner_id):
                job = ClipperJob(id="job-1", status="done", current_step="done", user_id=owner_id)
                with (
                    patch.object(registry, "get_job", return_value=job),
                    patch.object(registry, "_delete_job_assets") as delete_assets,
                ):
                    with self.assertRaises(registry.JobDeleteNotFoundError):
                        registry.delete_job_with_assets(job.id, "user-1")
                delete_assets.assert_not_called()

    def test_active_project_cannot_be_deleted(self):
        active_states = (
            ("queued", "queued"),
            ("running", "transcribing"),
            ("running", "analyzing"),
            ("rendering", "rendering"),
        )
        for status, step in active_states:
            with self.subTest(status=status, step=step):
                job = ClipperJob(id="job-1", status=status, current_step=step, user_id="user-1")
                with (
                    patch.object(registry, "get_job", return_value=job),
                    patch.object(registry, "_delete_job_assets") as delete_assets,
                ):
                    with self.assertRaises(registry.JobDeleteActiveError):
                        registry.delete_job_with_assets(job.id, "user-1")
                delete_assets.assert_not_called()

    def test_asset_failure_preserves_project_record(self):
        job = ClipperJob(id="job-1", status="failed", current_step="failed", user_id="user-1")
        with (
            patch.object(registry, "get_job", return_value=job),
            patch.object(registry, "_delete_job_assets", side_effect=RuntimeError("R2 unavailable")),
            patch.object(registry, "delete_job") as delete_record,
        ):
            with self.assertRaises(registry.JobDeleteCleanupError):
                registry.delete_job_with_assets(job.id, "user-1")
        delete_record.assert_not_called()

    def test_cleanup_removes_known_r2_objects_and_local_directory(self):
        job = ClipperJob(
            id="job-1",
            status="done",
            current_step="done",
            user_id="user-1",
            outputs=[
                {
                    "video_key": "podcast/job-1/outputs/clip.mp4",
                    "subtitle_key": "podcast/job-1/outputs/clip.srt",
                    "cover_options": [
                        {
                            "cover_key": "podcast/job-1/outputs/cover.jpg",
                            "frame_key": "podcast/job-1/outputs/frame.jpg",
                        }
                    ],
                }
            ],
        )
        with tempfile.TemporaryDirectory() as temporary_root:
            podcast_root = Path(temporary_root) / "podcast"
            project_dir = podcast_root / job.id
            project_dir.mkdir(parents=True)
            (project_dir / "metadata.json").write_text("{}", encoding="utf-8")

            def task_dir(name):
                return str(Path(temporary_root) / name)

            with (
                patch.object(registry.utils, "task_dir", side_effect=task_dir),
                patch.object(registry.r2_storage, "delete_file", return_value=True) as delete_r2,
            ):
                registry._delete_job_assets(job)

            self.assertFalse(project_dir.exists())
            self.assertEqual(delete_r2.call_count, 4)

    def test_controller_maps_active_project_to_conflict(self):
        with patch.object(
            registry,
            "delete_job_with_assets",
            side_effect=registry.JobDeleteActiveError("job-1"),
        ):
            with self.assertRaises(HttpException) as raised:
                podcast_controller.delete_podcast_job("job-1", "user-1")
        self.assertEqual(raised.exception.status_code, 409)


class TestClipperDatabaseDeletion(unittest.TestCase):
    def test_supabase_delete_filters_by_project_and_user(self):
        response = MagicMock(ok=True)
        with (
            patch.object(clipper_database, "configured", return_value=True),
            patch.object(clipper_database, "_request", return_value=response) as request,
        ):
            deleted = clipper_database.delete_job("job-1", user_id="user-1")

        self.assertTrue(deleted)
        self.assertEqual(
            request.call_args.kwargs["params"],
            {"id": "eq.job-1", "user_id": "eq.user-1"},
        )


if __name__ == "__main__":
    unittest.main()
