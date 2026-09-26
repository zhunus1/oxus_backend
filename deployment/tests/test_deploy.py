"""Exercise deployment ordering and failure handling with a fake Docker CLI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

IMAGE = "ghcr.io/zhunus1/oxus_backend@sha256:" + "a" * 64
OLD_IMAGE = "ghcr.io/zhunus1/oxus_backend@sha256:" + "b" * 64
DOCKER = r"""
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['CALLS'], 'a') as out: out.write(json.dumps(args)+'\n')
scenario=os.environ['SCENARIO']
state=Path(os.environ['MOCK_STATE'])
if args[0]=='compose':
    args=args[args.index('compose.yaml')+1:]
    if args[:1]==['config'] and '--format' in args:
        print(json.dumps({'services':{'backend':{'environment':{'STAGING':os.environ['STAGING_TEST']}}}}))
    elif args[:1]==['pull'] and scenario=='pull-failure': sys.exit(1)
    elif args[:1]==['ps']: print(args[-1]+'-id')
    elif args[:1]==['up'] and args[-1]=='backend': state.write_text('new')
    elif args[:3]==['exec','-T','db']:
        if 'pg_restore' in args: print('archive contents')
        elif scenario=='backup-failure': sys.exit(1)
        else: print('database dump fixture')
elif args[0]=='inspect':
    template=args[2]
    if template=='{{.State.Running}}': print('false' if args[-1]=='migrator-id' and scenario!='running-migration' else 'true')
    elif template=='{{.State.Health.Status}}': print('healthy')
    elif template=='{{.Config.Image}}': print(os.environ['BACKEND_IMAGE'] if state.exists() and scenario!='wrong-image' else os.environ['OLD_IMAGE'])
    elif template=='{{.Image}}': print('sha256:fixture-image')
    else: print(os.environ['OLD_IMAGE']+' sha256:previous-image')
elif args[:2]==['image','inspect']: print('sha256:fixture-image')
elif args[0]=='wait': print('1' if scenario=='migration-failure' else '0')
"""


class DeployTests(unittest.TestCase):
    def run_deploy(
        self, scenario="success", environment="production", staging=None, image=IMAGE
    ):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            docker = bin_dir / "docker"
            docker.write_text("#!" + sys.executable + "\n" + DOCKER)
            docker.chmod(0o700)
            script = (Path(__file__).parents[1] / "deploy.sh").read_text()
            # Only the real root requirement and backup path are replaced in the fixture.
            script = script.replace("[[ $EUID == 0 ]]", "[[ true ]]").replace(
                "/var/backups", str(root / "backups")
            )
            (root / "deploy.sh").write_text(script)
            original = (
                "BACKEND_IMAGE=" + OLD_IMAGE + "\nSECRET=literal$(do-not-execute)\n"
            )
            (root / ".env").write_text(original)
            (root / ".env").chmod(0o600)
            (root / "compose.yaml").write_text("services: {}\n")
            (root / "jitsi-private-key.pk").write_text("fixture key")
            # flock is not installed on macOS. The Linux lock itself is checked in CI.
            if sys.platform == "darwin":
                (bin_dir / "flock").write_text("#!/bin/sh\nexit 0\n")
                (bin_dir / "flock").chmod(0o700)
                (bin_dir / "sha256sum").write_text(
                    '#!/bin/sh\nexec shasum -a 256 "$@"\n'
                )
                (bin_dir / "sha256sum").chmod(0o700)
            env = {
                **os.environ,
                "PATH": str(bin_dir) + ":" + os.environ["PATH"],
                "CALLS": str(root / "calls"),
                "SCENARIO": scenario,
                "MOCK_STATE": str(root / "state"),
                "OLD_IMAGE": OLD_IMAGE,
                "STAGING_TEST": staging
                or ("false" if environment == "production" else "true"),
            }
            result = subprocess.run(
                ["bash", str(root / "deploy.sh"), environment, image],
                env=env,
                capture_output=True,
                text=True,
            )
            calls = (
                [json.loads(line) for line in (root / "calls").read_text().splitlines()]
                if (root / "calls").exists()
                else []
            )
            return (
                result,
                calls,
                (root / ".env").read_text(),
                list((root / "backups").glob("*/database.dump")),
            )

    def test_production_backs_up_before_migration_and_persists_digest(self):
        result, calls, env, dumps = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        backup = next(i for i, c in enumerate(calls) if any("pg_dump" in a for a in c))
        migration = next(i for i, c in enumerate(calls) if "--force-recreate" in c)
        self.assertLess(backup, migration)
        self.assertIn("BACKEND_IMAGE=" + IMAGE, env)
        self.assertIn("SECRET=literal$(do-not-execute)", env)
        self.assertEqual(len(dumps), 1)

    def test_test_deploy_does_not_restore_or_dump_databases(self):
        result, calls, env, dumps = self.run_deploy(environment="test")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(
            any(any("pg_dump" in a or "pg_restore" in a for a in c) for c in calls)
        )
        self.assertFalse(dumps)

    def test_failed_backup_restarts_previous_container_without_migrations(self):
        result, calls, env, _ = self.run_deploy("backup-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(["start", "backend-id"], calls)
        self.assertFalse(any("--force-recreate" in c for c in calls))
        self.assertIn(OLD_IMAGE, env)

    def test_failed_migration_does_not_start_new_backend_or_change_env(self):
        result, calls, env, _ = self.run_deploy("migration-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("up" in c and c[-1] == "backend" for c in calls))
        self.assertIn(OLD_IMAGE, env)

    def test_failed_pull_does_not_stop_the_application(self):
        result, calls, env, _ = self.run_deploy("pull-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[0] == "stop" for c in calls))

    def test_running_migration_blocks_a_new_deploy(self):
        result, calls, env, _ = self.run_deploy("running-migration")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[0] == "stop" or "--force-recreate" in c for c in calls))

    def test_environment_mismatch_and_mutable_image_fail_before_stopping(self):
        for options in [
            {"staging": "true"},
            {"image": "ghcr.io/zhunus1/oxus_backend:test"},
        ]:
            with self.subTest(options=options):
                result, calls, env, _ = self.run_deploy(**options)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c[0] == "stop" for c in calls))

    def test_wrong_running_image_is_not_recorded_as_successful(self):
        result, calls, env, _ = self.run_deploy("wrong-image")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(OLD_IMAGE, env)


if __name__ == "__main__":
    unittest.main()
