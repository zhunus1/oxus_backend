"""Real Compose environment probe; no application, network services or real secrets.

The real FreedomPay service executes inside each probe container with mocked HTTP.
Requires Docker, built backend, node_modules and a local node:22-alpine image.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]


class FreedomModeRuntimeTests(unittest.TestCase):
    def test_rendered_callback_defaults_and_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "synthetic.env"
            for stack, example in [("compose.yaml", ".env.example"),
                                   ("deployment/compose.yaml", "deployment/.env.example")]:
                for mode in ["example", "override"] + (["fallback"] if stack == "compose.yaml" else []):
                    with self.subTest(stack=stack, mode=mode):
                        lines = (ROOT / example).read_text().splitlines()
                        expected = next(line.split("=", 1)[1] for line in lines if line.startswith("FREEDOM_RESULT_URL="))
                        if mode == "fallback":
                            lines = [line for line in lines if not line.startswith("FREEDOM_RESULT_URL=")]
                        env_file.write_text("\n".join(lines))
                        env = dict(os.environ)
                        env.pop("FREEDOM_RESULT_URL", None)
                        if mode == "override":
                            expected = "https://example.test/api/v1/payment/freedompay-webhook"
                            env["FREEDOM_RESULT_URL"] = expected
                        result = subprocess.run(["docker", "compose", "--env-file", str(env_file),
                            "-f", str(ROOT / stack), "config", "--format", "json"],
                            env=env, capture_output=True, text=True)
                        self.assertEqual(result.returncode, 0, result.stderr)
                        callback = json.loads(result.stdout)["services"]["backend"]["environment"]["FREEDOM_RESULT_URL"]
                        self.assertEqual(callback, expected)
                        self.assertEqual(urlparse(callback).path, "/api/v1/payment/freedompay-webhook")
                        print(json.dumps({"stack": stack, "mode": mode, "resultUrl": callback}))

    def test_effective_mode_in_both_compose_stacks(self):
        override = """services:
  backend:
    image: node:22-alpine
    build: !reset null
    volumes: !reset []
    ports: !reset []
    depends_on: !reset {}
    healthcheck:
      disable: true
    restart: "no"
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "override.yaml"
            path.write_text(override)
            env_file = Path(directory) / "synthetic.env"
            env_file.write_text("\n".join(line for line in (ROOT / "deployment/.env.example").read_text().splitlines()
                                         if not line.startswith("FREEDOM_TESTING_MODE=")))
            for stack in ["compose.yaml", "deployment/compose.yaml"]:
                project = "oxus-mode-" + uuid.uuid4().hex[:12]
                cmd = ["docker", "compose", "--project-name", project,
                       "--env-file", str(env_file),
                       "-f", str(ROOT / stack), "-f", str(path)]
                try:
                    for requested in ["1", "0", "invalid", "", None]:
                        with self.subTest(stack=stack, requested=requested):
                            env = dict(os.environ)
                            env.pop("FREEDOM_RESULT_URL", None)
                            if requested is None:
                                env.pop("FREEDOM_TESTING_MODE", None)
                            else:
                                env["FREEDOM_TESTING_MODE"] = requested
                            result = subprocess.run(cmd + ["run", "--rm", "--no-deps", "--entrypoint", "node",
                                "-v", str(ROOT) + ":/probe:ro", "backend", "/probe/deployment/tests/freedom-mode-probe.cjs"],
                                env=env, capture_output=True, text=True)
                            self.assertEqual(result.returncode, 0, result.stderr)
                            service = json.loads(result.stdout)
                            effective = service["effectiveMode"]
                            self.assertEqual(urlparse(service["resultUrl"]).path, service["callbackPath"])
                            self.assertEqual(effective, "0" if requested is None else requested)
                            print(json.dumps({"stack": stack, "requested": requested, "effective": effective,
                                              "service": service}))
                finally:
                    # No down: that would also target other services declared in these files.
                    subprocess.run(["docker", "network", "rm", project + "_default"], capture_output=True, check=True)
