import unittest

from app.services.ai_service import AIService


class AISummaryTests(unittest.TestCase):
    def setUp(self):
        self.service = AIService()
        self.payload = {
            "number": 2,
            "title": "master-abhishek",
            "body": "",
            "commits": [
                "feat: add enrollment and progress APIs",
                "refactor: extract enrollment service logic",
            ],
            "comments": [],
            "reviews": [],
            "files": [
                "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/controller/EnrollmentController.java",
                "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/service/EnrollmentService.java",
            ],
            "file_changes": [
                {
                    "filename": "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/controller/EnrollmentController.java",
                    "status": "modified",
                    "additions": 120,
                    "deletions": 18,
                    "changes": 138,
                    "patch_excerpt": "@@ -1,1 +1,10 @@ ...",
                },
                {
                    "filename": "src/main/java/io/github/grihithreddy/onlinecoursemanagement/enrollment/service/EnrollmentService.java",
                    "status": "added",
                    "additions": 160,
                    "deletions": 0,
                    "changes": 160,
                    "patch_excerpt": "@@ -0,0 +1,30 @@ ...",
                },
            ],
            "change_stats": {
                "file_count": 2,
                "additions": 280,
                "deletions": 18,
                "renamed_files": 0,
                "added_files": 1,
                "removed_files": 0,
            },
        }

    def test_fallback_summary_uses_code_changes_when_text_is_empty(self):
        summary = self.service._fallback_summary(self.payload)

        self.assertIn("updates 2 files", summary["summary"].lower())
        self.assertNotIn("no files were changed", summary["summary"].lower())
        self.assertTrue(summary["intent"])
        self.assertIn("code-intent", summary["tags"])

    def test_normalize_summary_rejects_incorrect_no_files_claim(self):
        parsed = {
            "summary": "No files were changed as part of this pull request.",
            "intent": "No clear change intent.",
            "decisions": [],
            "risks": [],
            "tags": [],
        }

        normalized = self.service._normalize_summary(parsed, self.payload)

        self.assertNotIn("no files were changed", normalized["summary"].lower())
        self.assertIn("updates 2 files", normalized["summary"].lower())
        self.assertTrue(normalized["decisions"])

    def test_code_reference_notes_are_file_specific_when_repeated(self):
        raw_code_refs = [
            {
                "file_path": "src/main/java/com/acme/EnrollmentController.java",
                "start_line": 1,
                "end_line": 60,
                "pr_number": 1,
                "note": "The primary intent of this change is to implement enrollment flow.",
            },
            {
                "file_path": "src/main/java/com/acme/EnrollmentProgressController.java",
                "start_line": 1,
                "end_line": 43,
                "pr_number": 1,
                "note": "The primary intent of this change is to implement enrollment flow.",
            },
        ]

        normalized = self.service._normalize_code_references(raw_code_refs, context_sources=[])

        self.assertEqual(len(normalized), 2)
        self.assertNotEqual(normalized[0]["note"], normalized[1]["note"])
        self.assertIn("EnrollmentController.java", normalized[0]["note"])
        self.assertIn("EnrollmentProgressController.java", normalized[1]["note"])

    def test_fallback_chat_omits_code_refs_for_high_level_query(self):
        context_sources = [
            {
                "pr_number": 1,
                "pr_title": "master-abhi",
                "summary": "Implements enrollment and progress flow.",
                "intent": "Implement core enrollment flow.",
                "files": [
                    {
                        "file_path": "src/main/java/com/acme/EnrollmentController.java",
                        "start_line": 1,
                        "end_line": 60,
                    }
                ],
            }
        ]

        payload = self.service._fallback_chat_payload(
            query="what did master-abhi do",
            context_sources=context_sources,
            repo_overview_context=None,
        )
        structured = payload.get("structured") or {}
        self.assertEqual(structured.get("code_references"), [])

    def test_fallback_chat_keeps_code_refs_for_code_query(self):
        context_sources = [
            {
                "pr_number": 1,
                "pr_title": "master-abhi",
                "summary": "Implements enrollment and progress flow.",
                "intent": "Implement core enrollment flow.",
                "files": [
                    {
                        "file_path": "src/main/java/com/acme/EnrollmentController.java",
                        "start_line": 1,
                        "end_line": 60,
                    }
                ],
            }
        ]

        payload = self.service._fallback_chat_payload(
            query="which files and lines changed in master-abhi",
            context_sources=context_sources,
            repo_overview_context=None,
        )
        structured = payload.get("structured") or {}
        refs = structured.get("code_references") or []
        self.assertTrue(refs)

    def test_fallback_chat_includes_memory_sections_when_memory_available(self):
        payload = self.service._fallback_chat_payload(
            query="continue with the same approach",
            context_sources=[],
            repo_overview_context=None,
            memory_context={
                "recent_messages": [
                    {"role": "user", "content": "We are migrating auth middleware to JWT."},
                ],
                "memory_items": [
                    {
                        "scope": "conversation",
                        "kind": "active_task",
                        "key": "current_task",
                        "value": "Migrate auth middleware to JWT tokens.",
                    }
                ],
            },
        )
        structured = payload.get("structured") or {}
        section_titles = [str(section.get("heading") or "") for section in (structured.get("sections") or [])]
        self.assertIn("Conversation Memory", section_titles)
        self.assertIn("Recent Context", section_titles)

    def test_simple_conversation_uses_plain_format(self):
        normalized = self.service._normalize_chat_structure(
            {
                "format": "structured",
                "title": "Last User Question",
                "summary": 'You asked: "What was my last question?"',
                "sections": [{"heading": "Last Question", "bullets": ["You asked about Enrollment.java."]}],
                "limitations": [],
            },
            context_sources=[],
            repo_overview_context=None,
            query="What was my last question?",
        )

        self.assertEqual(normalized["format"], "plain")
        self.assertEqual(self.service._format_structured_answer(normalized), normalized["summary"])
        self.assertFalse(self.service._query_prefers_structured_response("How are you?"))

    def test_structured_format_is_kept_for_code_and_analysis_questions(self):
        self.assertTrue(self.service._query_prefers_structured_response("Show me the code for AuthService.java"))
        self.assertTrue(self.service._query_prefers_structured_response("Compare the authentication approaches"))
        self.assertTrue(self.service._query_prefers_structured_response("Explain the entire repo"))

    def test_generic_limitations_are_removed(self):
        limitations = self.service._sanitize_limitations_for_code_context(
            [
                "Some line-level ranges may be unavailable when upstream patches omit hunk data.",
                "Conversation memory was used to resolve follow-up context; confirm if priorities changed.",
                "The requested file was not present on the default branch.",
            ]
        )

        self.assertEqual(limitations, ["The requested file was not present on the default branch."])

    def test_compact_sources_keep_pull_request_timestamps(self):
        source = {
            "entry_id": "entry-1",
            "pr_number": 2,
            "pr_title": "master-abhishek",
            "pr_created_at": "2026-10-28T15:42:00+00:00",
            "pr_updated_at": "2026-10-29T10:00:00+00:00",
            "pr_merged_at": "2026-10-29T10:05:00+00:00",
        }

        compact = self.service._compact_sources([source])[0]

        self.assertEqual(compact["pr_created_at"], source["pr_created_at"])
        self.assertEqual(compact["pr_updated_at"], source["pr_updated_at"])
        self.assertEqual(compact["pr_merged_at"], source["pr_merged_at"])


if __name__ == "__main__":
    unittest.main()
