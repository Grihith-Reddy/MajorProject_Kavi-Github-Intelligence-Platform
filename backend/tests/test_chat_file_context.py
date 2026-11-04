import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.api.chat import (
    _build_requested_file_answer,
    _extract_requested_file_path,
    _match_requested_file_paths,
    _resolve_requested_file,
)


class ChatFileContextTests(unittest.TestCase):
    def test_extracts_file_requested_as_code(self):
        self.assertEqual(
            _extract_requested_file_path("Give me the code of the file Enrollment.java"),
            "Enrollment.java",
        )

    def test_extracts_repository_relative_windows_path(self):
        self.assertEqual(
            _extract_requested_file_path(r"Show me the contents of src\main\Enrollment.java"),
            "src/main/Enrollment.java",
        )

    def test_does_not_treat_file_explanation_as_code_request(self):
        self.assertIsNone(_extract_requested_file_path("Explain what Enrollment.java is responsible for"))

    def test_matches_exact_path_or_unique_basename(self):
        paths = [
            "src/main/java/com/example/Enrollment.java",
            "src/test/java/com/example/EnrollmentTest.java",
        ]
        self.assertEqual(
            _match_requested_file_paths("src/main/java/com/example/Enrollment.java", paths),
            ["src/main/java/com/example/Enrollment.java"],
        )
        self.assertEqual(
            _match_requested_file_paths("Enrollment.java", paths),
            ["src/main/java/com/example/Enrollment.java"],
        )

    def test_returns_all_duplicate_basenames_for_ambiguity_handling(self):
        paths = ["service/Enrollment.java", "model/Enrollment.java"]
        self.assertEqual(
            _match_requested_file_paths("Enrollment.java", paths),
            paths,
        )

    def test_exact_file_answer_contains_fetched_content_verbatim(self):
        content = "public class Enrollment {\n    private long id;\n}\n"
        response = _build_requested_file_answer(
            "Enrollment.java",
            {
                "status": "found",
                "repo_full_name": "example/course-app",
                "branch": "main",
                "file_path": "src/main/java/Enrollment.java",
                "content": content,
                "truncated": False,
            },
        )

        snippet = response["structured"]["code_snippets"][0]
        self.assertEqual(snippet["code"], content)
        self.assertEqual(snippet["source"], "repository")
        self.assertIn(content, response["answer"])

    def test_missing_file_response_does_not_invent_file_contents(self):
        response = _build_requested_file_answer(
            "Enrollment.java",
            {
                "status": "not_found",
                "repo_full_name": "example/course-app",
                "branch": "main",
            },
        )

        self.assertEqual(response["structured"]["code_snippets"], [])
        self.assertIn("could not find an exact match", response["structured"]["summary"])
        self.assertIn("not guessed or generated", response["structured"]["summary"])

    @patch("app.api.chat.decrypt_token", return_value="token")
    @patch("app.api.chat.require_github_account", return_value={"access_token_encrypted": "encrypted"})
    @patch("app.api.chat.require_user_id", return_value="user-id")
    @patch("app.api.chat.GitHubService")
    def test_resolves_exact_file_from_authorized_repository(
        self,
        github_service,
        _require_user_id,
        _require_github_account,
        _decrypt_token,
    ):
        github = github_service.return_value
        github.get_repository.return_value = {"default_branch": "main"}
        github.list_repository_tree.return_value = [
            {"path": "src/main/java/example/EnrollmentService.java"},
            {"path": "src/main/java/example/Enrollment.java"},
        ]
        github.get_file_content.return_value = "public class Enrollment {}\n"

        result = _resolve_requested_file(
            db=object(),
            requested_path="Enrollment.java",
            current_user=SimpleNamespace(sub="firebase-user"),
            repo_meta={"full_name": "example/course-app", "default_branch": "main"},
        )

        self.assertEqual(result["status"], "found")
        self.assertEqual(result["file_path"], "src/main/java/example/Enrollment.java")
        self.assertEqual(result["content"], "public class Enrollment {}\n")
        github.search_code_paths.assert_not_called()
        github.get_file_content.assert_called_once_with(
            "example/course-app",
            "src/main/java/example/Enrollment.java",
            ref="main",
            max_chars=60000,
        )

    @patch("app.api.chat.decrypt_token", return_value="token")
    @patch("app.api.chat.require_github_account", return_value={"access_token_encrypted": "encrypted"})
    @patch("app.api.chat.require_user_id", return_value="user-id")
    @patch("app.api.chat.GitHubService")
    def test_duplicate_basename_is_not_guessed(
        self,
        github_service,
        _require_user_id,
        _require_github_account,
        _decrypt_token,
    ):
        github = github_service.return_value
        github.get_repository.return_value = {"default_branch": "main"}
        github.list_repository_tree.return_value = [
            {"path": "service/Enrollment.java"},
            {"path": "model/Enrollment.java"},
        ]

        result = _resolve_requested_file(
            db=object(),
            requested_path="Enrollment.java",
            current_user=SimpleNamespace(sub="firebase-user"),
            repo_meta={"full_name": "example/course-app", "default_branch": "main"},
        )

        self.assertEqual(result["status"], "ambiguous")
        self.assertEqual(result["matches"], ["service/Enrollment.java", "model/Enrollment.java"])
        github.get_file_content.assert_not_called()


if __name__ == "__main__":
    unittest.main()
