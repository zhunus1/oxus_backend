"""Do not certify deployments made by a server with the obsolete script."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

IMAGE = "ghcr.io/zhunus1/oxus_backend@sha256:" + "a" * 64


class SSHTests(unittest.TestCase):
    def invoke(self, response, **overrides):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ssh = root / "ssh"
            ssh.write_text(
                '#!/bin/sh\nprintf "%s\\n" "$*" > "$SSH_CALL"\nprintf "%s\\n" "$SSH_RESPONSE"\n'
            )
            ssh.chmod(0o700)
            env = {
                **os.environ,
                "PATH": directory + ":" + os.environ["PATH"],
                "DEPLOY_IMAGE": IMAGE,
                "DEPLOY_ENVIRONMENT": "production",
                "DEPLOY_HOST": "87.106.144.28",
                "DEPLOY_SSH_PRIVATE_KEY": "fixture",
                "DEPLOY_SSH_KNOWN_HOSTS": "fixture",
                "SSH_CALL": str(root / "call"),
                "SSH_RESPONSE": response,
                "RUNNER_TEMP": directory,
                **overrides,
            }
            script = Path(__file__).parents[1] / "ssh-deploy.sh"
            result = subprocess.run(
                ["bash", str(script)], env=env, capture_output=True, text=True
            )
            return result.returncode, (root / "call").read_text() if (
                root / "call"
            ).exists() else None

    def test_accepts_the_exact_server_digest_receipt(self):
        code, call = self.invoke("Deployment healthy: production " + IMAGE)
        self.assertEqual(code, 0)
        self.assertIn("StrictHostKeyChecking=yes", call)
        self.assertIn(
            "sudo -n /opt/oxus_backend/deployment/deploy.sh production " + IMAGE, call
        )

    def test_old_server_success_is_not_a_verified_release(self):
        code, call = self.invoke("OxusEdu backend deployment is healthy.")
        self.assertNotEqual(code, 0)
        self.assertIsNotNone(call)

    def test_bad_inputs_are_rejected_before_ssh(self):
        for overrides in [
            {"DEPLOY_IMAGE": "ghcr.io/zhunus1/oxus_backend:test"},
            {"DEPLOY_HOST": "host; echo bad"},
            {"DEPLOY_SSH_PRIVATE_KEY": ""},
        ]:
            with self.subTest(overrides=overrides):
                code, call = self.invoke("", **overrides)
                self.assertNotEqual(code, 0)
                self.assertIsNone(call)
