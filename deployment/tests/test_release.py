import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "release", Path(__file__).parents[1] / "release.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.repository = "zhunus1/oxus_backend"
        self.tree = "a" * 40
        self.run = {
            "id": 42,
            "run_attempt": 2,
            "head_sha": "b" * 40,
            "repository": {"full_name": self.repository},
            "path": ".github/workflows/ci.yml",
            "head_branch": "test",
            "event": "push",
            "status": "completed",
            "conclusion": "success",
        }
        self.manifest = {
            "schema": 1,
            "repository": self.repository,
            "run_id": 42,
            "run_attempt": 2,
            "commit": self.run["head_sha"],
            "tree": self.tree,
            "image": "ghcr.io/zhunus1/oxus_backend@sha256:" + "c" * 64,
        }

    def validate(self, manifest=None, run=None, main_tree=None):
        return release.validate(
            manifest or self.manifest,
            run or self.run,
            self.repository,
            self.tree,
            main_tree or self.tree,
        )

    def test_identical_tree_allows_merge_commit_with_different_sha(self):
        self.assertEqual(self.validate(), self.manifest["image"])

    def test_changed_main_cannot_deploy_older_tested_code(self):
        with self.assertRaisesRegex(ValueError, "source files differ"):
            self.validate(main_tree="d" * 40)

    def test_rejects_untrusted_or_unsuccessful_runs(self):
        for field, value in [
            ("head_branch", "main"),
            ("event", "pull_request"),
            ("status", "in_progress"),
            ("conclusion", "failure"),
            ("path", ".github/workflows/other.yml"),
            ("repository", {"full_name": "other/repo"}),
        ]:
            with self.subTest(field=field):
                run = copy.deepcopy(self.run)
                run[field] = value
                with self.assertRaises(ValueError):
                    self.validate(run=run)

    def test_rejects_mutable_or_foreign_images_and_wrong_artifacts(self):
        for field, value in [
            ("image", "ghcr.io/zhunus1/oxus_backend:test"),
            ("image", "ghcr.io/other/repo@sha256:" + "c" * 64),
            ("run_id", 41),
            ("run_attempt", 1),
            ("commit", "d" * 40),
            ("tree", "e" * 40),
            ("schema", 0),
        ]:
            with self.subTest(field=field):
                manifest = {**self.manifest, field: value}
                with self.assertRaises(ValueError):
                    self.validate(manifest=manifest)

    def test_select_uses_matching_release_not_latest_test_code(self):
        newer = {**self.run, "id": 43, "head_sha": "f" * 40}
        with tempfile.TemporaryDirectory() as folder:
            env = {
                "GITHUB_REF": "refs/heads/main",
                "GITHUB_REPOSITORY": self.repository,
                "GITHUB_SHA": "d" * 40,
                "GITHUB_OUTPUT": folder + "/output",
                "GITHUB_STEP_SUMMARY": folder + "/summary",
            }

            def command(*args):
                if args[:2] == ("gh", "api"):
                    return json.dumps([{"workflow_runs": [newer, self.run]}])
                self.assertEqual(args[3], "42")
                Path(args[-1], "release.json").write_text(json.dumps(self.manifest))
                return ""

            def tree(commit):
                return "0" * 40 if commit == newer["head_sha"] else self.tree

            with (
                patch.dict(os.environ, env),
                patch.object(release, "command", side_effect=command),
                patch.object(release, "tree", side_effect=tree),
            ):
                release.select()
            self.assertEqual(
                Path(folder, "output").read_text(),
                "image=" + self.manifest["image"] + "\n",
            )

    def test_missing_artifact_does_not_fall_back_to_mutable_tag(self):
        def command(*args):
            if args[:2] == ("gh", "api"):
                return json.dumps([{"workflow_runs": [self.run]}])
            raise subprocess.CalledProcessError(1, args)

        env = {
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_REPOSITORY": self.repository,
            "GITHUB_SHA": "d" * 40,
        }
        with (
            patch.dict(os.environ, env),
            patch.object(release, "command", side_effect=command),
            patch.object(release, "tree", return_value=self.tree),
        ):
            with self.assertRaisesRegex(ValueError, "No successful Test release"):
                release.select()

    def test_record_is_not_available_from_main(self):
        with patch.dict(os.environ, {"GITHUB_REF": "refs/heads/main"}):
            with self.assertRaises(ValueError):
                release.record()


if __name__ == "__main__":
    unittest.main()
