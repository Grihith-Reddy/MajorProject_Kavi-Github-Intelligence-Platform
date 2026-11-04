import unittest
from unittest.mock import patch

from app.workers import ingestion_worker


class IngestionWorkerCliTests(unittest.TestCase):
    @patch("app.workers.ingestion_worker.logging.basicConfig")
    @patch("app.workers.ingestion_worker.run_forever")
    @patch("app.workers.ingestion_worker.process_one_job")
    def test_once_option_processes_one_job_and_exits(
        self,
        process_one_job,
        run_forever,
        _basic_config,
    ):
        ingestion_worker.main(["--once"])

        process_one_job.assert_called_once_with()
        run_forever.assert_not_called()

    @patch("app.workers.ingestion_worker.logging.basicConfig")
    @patch("app.workers.ingestion_worker.run_forever")
    @patch("app.workers.ingestion_worker.process_one_job")
    def test_default_mode_runs_continuously(
        self,
        process_one_job,
        run_forever,
        _basic_config,
    ):
        ingestion_worker.main([])

        run_forever.assert_called_once_with()
        process_one_job.assert_not_called()


if __name__ == "__main__":
    unittest.main()
