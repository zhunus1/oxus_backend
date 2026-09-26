#!/usr/bin/env python3
"""Record a tested digest and promote it only when its Git tree matches main."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def command(*args: str) -> str:
    return subprocess.run(
        args, check=True, capture_output=True, text=True
    ).stdout.strip()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def tree(commit: str) -> str:
    require(bool(re.fullmatch(r"[a-f0-9]{40}", commit)), "Invalid commit SHA")
    try:
        return command("git", "rev-parse", commit + "^{tree}")
    except subprocess.CalledProcessError:
        command("git", "fetch", "--no-tags", "origin", commit)
        return command("git", "rev-parse", commit + "^{tree}")


def validate(
    manifest: dict, run: dict, repository: str, source_tree: str, main_tree: str
) -> str:
    require(
        run.get("repository", {}).get("full_name") == repository, "Wrong repository"
    )
    require(run.get("path") == ".github/workflows/ci.yml", "Wrong workflow")
    require(run.get("head_branch") == "test", "Release did not come from test")
    require(run.get("event") in ("push", "workflow_dispatch"), "Not a branch build")
    require(
        run.get("status") == "completed" and run.get("conclusion") == "success",
        "Test run is not successful",
    )
    require(
        manifest.get("schema") == 1 and manifest.get("repository") == repository,
        "Invalid release manifest",
    )
    require(
        manifest.get("run_id") == run["id"]
        and manifest.get("run_attempt") == run["run_attempt"],
        "Artifact belongs to another run/attempt",
    )
    require(manifest.get("commit") == run["head_sha"], "Artifact commit mismatch")
    require(
        manifest.get("tree") == source_tree == main_tree,
        "Test and main source files differ",
    )
    image = manifest.get("image", "")
    require(
        bool(
            re.fullmatch(
                re.escape("ghcr.io/" + repository.lower()) + r"@sha256:[a-f0-9]{64}",
                image,
            )
        ),
        "Image must be an exact digest from this repository",
    )
    return image


def record() -> None:
    require(
        os.environ["GITHUB_REF"] == "refs/heads/test", "Only test can record a release"
    )
    repository = os.environ["GITHUB_REPOSITORY"]
    image = os.environ["DEPLOY_IMAGE"]
    require(
        bool(
            re.fullmatch(
                re.escape("ghcr.io/" + repository.lower()) + r"@sha256:[a-f0-9]{64}",
                image,
            )
        ),
        "Invalid tested image",
    )
    manifest = {
        "schema": 1,
        "repository": repository,
        "run_id": int(os.environ["GITHUB_RUN_ID"]),
        "run_attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "commit": os.environ["GITHUB_SHA"],
        "tree": tree(os.environ["GITHUB_SHA"]),
        "image": image,
    }
    Path("release-artifact").mkdir(exist_ok=True)
    Path("release-artifact/release.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(
            f"Tested release: `{image}`\n\nSource commit: `{manifest['commit']}`\n"
        )


def select() -> None:
    require(
        os.environ["GITHUB_REF"] == "refs/heads/main",
        "Production releases must run from main",
    )
    repository = os.environ["GITHUB_REPOSITORY"]
    main_tree = tree(os.environ["GITHUB_SHA"])
    pages = json.loads(
        command(
            "gh",
            "api",
            "--paginate",
            "--slurp",
            f"repos/{repository}/actions/workflows/ci.yml/runs?branch=test&status=success&per_page=100",
        )
    )
    runs = [run for page in pages for run in page["workflow_runs"]]
    for run in sorted(
        runs, key=lambda item: (item["id"], item["run_attempt"]), reverse=True
    ):
        source_tree = tree(run["head_sha"])
        if source_tree != main_tree:
            continue
        with tempfile.TemporaryDirectory(prefix="tested-release-") as directory:
            try:
                command(
                    "gh",
                    "run",
                    "download",
                    str(run["id"]),
                    "--repo",
                    repository,
                    "--name",
                    "tested-release",
                    "--dir",
                    directory,
                )
            except subprocess.CalledProcessError:
                # Older runs may predate release manifests or have expired artifacts.
                continue
            manifest = json.loads((Path(directory) / "release.json").read_text())
            image = validate(manifest, run, repository, source_tree, main_tree)
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"image={image}\n")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(
                f"Promoting `{image}` from [successful Test run](https://github.com/{repository}/actions/runs/{run['id']}).\n"
            )
        print("Selected successfully tested image: " + image)
        return
    raise ValueError(
        "No successful Test release has exactly the same files as main. Deploy this code to test first; production was not changed."
    )


if __name__ == "__main__":
    try:
        require(
            len(sys.argv) == 2 and sys.argv[1] in ("record", "select"),
            "Usage: release.py record|select",
        )
        {"record": record, "select": select}[sys.argv[1]]()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(
            "Release verification failed: "
            + (str(error) if isinstance(error, ValueError) else type(error).__name__),
            file=sys.stderr,
        )
        sys.exit(1)
