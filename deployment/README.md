# Test and Production deployment

## Release flow

| Change               | Behaviour                                                                        |
| -------------------- | -------------------------------------------------------------------------------- |
| PR to `test`         | Lint, tests, application and Docker builds; no deployment                        |
| Push/merge to `test` | Build and publish an image, deploy its exact digest to Test                      |
| PR `test` → `main`   | Validate the release; other source branches are rejected                         |
| Push/merge to `main` | Run checks, then automatically promote a successfully tested image to Production |

Production does **not** build a second image or deploy the moving `:test` tag.
After a successful Test deployment, CI stores `tested-release/release.json` as a
GitHub Actions artifact for 90 days. It records the run/attempt, source commit,
Git tree and image digest. Production selects a successful Test CI run whose Git
tree exactly matches the `main` commit. A merge or squash commit can have a different
SHA while containing identical files. If the files differ, the artifact expired,
or Test failed, Production is not deployed. Sync `main` into `test`, deploy Test
again and release the matching code; do not bypass this check with a mutable tag.

Workflows are serialized per branch without cancelling an in-progress deployment.
The server also takes an exclusive lock. A superseded `main` run is skipped before
connecting to Production. The GitLab pipeline has been removed.

## Existing server layout

|                       | Test                                   | Production                     |
| --------------------- | -------------------------------------- | ------------------------------ |
| SSH host              | `test.oxusedu.com` / `217.154.218.174` | `87.106.144.28`                |
| Directory             | `/opt/oxus_backend/deployment`         | `/opt/oxus_backend/deployment` |
| Compose project       | `oxus_backend`                         | `oxus_backend`                 |
| Backend loopback port | `4000`                                 | `4100`                         |
| MinIO API/console     | `9000` / `9090`                        | `9100` / `9190`                |
| Environment           | `STAGING=true`                         | `STAGING=false`                |

The server's `.env`, Jitsi key, Compose files, volumes and host Nginx are retained.
`deploy.sh` includes `compose.override.yaml` when present, so the existing production
image pins and MinIO credentials are preserved. CI does not copy these files.
Frontend and landing deployments are independent of this backend workflow.

## One-time rollout of this CI change

Install the new server script **before pushing the new workflow to `test`**. The
old server script does not accept an immutable image argument. The new SSH client
requires the new script's exact success message and cannot certify an old deploy.

1. Copy `deployment/deploy.sh` and `deployment/install-ci.sh` into a temporary,
   root-owned directory on **both servers**. Run `bash install-ci.sh` there as root.
   This backs up the old script under `/var/backups/oxus-ci-setup-*`, installs the
   new root-owned script and grants `oxusdeploy` sudo access to that script only.
   It does not start a deployment or replace Compose, `.env`, keys or Nginx.
2. Keep the existing Test SSH key and `TEST_SSH_*` secrets. On Production, add a
   separate Actions Ed25519 public key: `bash install-ci.sh /root/oxus-prod-actions.pub`.
   The installer creates `oxusdeploy` if necessary, preserves existing authorized
   keys and adds the new key with SSH forwarding/PTY restrictions. Never give the
   CI account ownership of deployment configuration or membership in `docker`.
3. Configure the GitHub environments and their secrets below.
4. Commit these changes to `test` and push it. Wait for **the entire Test CI run**
   to succeed and produce the `tested-release` artifact. Check Test functionality.
5. Open a PR from `test` to `main`. Merging it enables the new main workflow and
   triggers Production promotion automatically after quality checks.

The first rollout can be a PR that introduces this workflow into `main`; the Test
artifact must already exist before merging. Keep `main` as the default branch.
If the existing Test environment allows deployments only from `main`, change its
allowed branch to `test` before the first Test push.

## GitHub settings

Settings → Environments:

| Environment | Allowed deployment branch | Environment secrets |
| ----------- | ------------------------- | ------------------- |
| `test` | `test` | `TEST_SSH_PRIVATE_KEY`, `TEST_SSH_KNOWN_HOSTS` |
| `production` | `main` | `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_KNOWN_HOSTS` |

Each deployment job references its GitHub environment, making that environment's
two SSH secrets available to the job. Keep the existing secrets in `test` and add
the two Production secrets in `production`. Additional secrets or variables are
not required: SSH hosts are set in the workflow to `test.oxusedu.com` for Test and
`87.106.144.28` for Production. Select the matching allowed branch in each
environment; leave required reviewers and wait timers disabled for automatic
deployment. Also protect branches as described below.

The private SSH key belongs in the corresponding GitHub secret, never in Git or chat.
Obtain the production host key **through your existing trusted SSH connection**:

```bash
# Run on Production; the printed host key is public.
awk '{print "87.106.144.28 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

Put that line into `PROD_SSH_KNOWN_HOSTS`. The workflow uses strict host-key checking.
It connects as `oxusdeploy`. Docker must be able to pull the package as root on each
server; for a private package, authenticate root to GHCR with `read:packages`.

Protect `main` and `test` with PRs and required checks. For `main`, require
`Install, lint, test, and build` and `Build and publish Test Docker image` from the PR,
block force pushes/deletion, and do not permit direct pushes to bypass the release
PR check. Set review requirements to match your actual team; a solo maintainer
should not require an approval they cannot provide. Use merge commits for ongoing
`test` → `main` releases to keep branch history easy to maintain.

## What a deployment does

The server script validates `test|production`, the repository and digest, and checks
that the selected environment matches `STAGING` in the server configuration. It:

1. Pulls only backend and migrator images before downtime.
2. Saves the previous configuration and image reference under `/var/backups/oxus-release-*`.
3. Stops the backend. On Production, takes a PostgreSQL custom-format dump and
   checks that `pg_restore --list` can read it before migrations. This is a database
   backup, not a media snapshot or a full restore test.
4. Recreates and waits for the migration container. Existing records are retained;
   Test data is never imported into Production by CI.
5. Starts the backend, waits for health and verifies its exact image reference/ID.
6. Atomically updates only `BACKEND_IMAGE` in `.env` and records `.deployed-image`
   and `.last-release-backup`. CI then checks the public API.

A database backup failure restarts the old backend without running migrations.
After migrations start, failures require inspection of the private release logs;
there is no automatic database restore or assumption that old code supports the
new schema. Preserve backward-compatible migrations. Backups accumulate deliberately;
copy and verify them off-server before applying your retention policy.

The successful exited migrator container is expected. No `down -v`, seed, MinIO
restore, infrastructure upgrade or Nginx edit occurs during routine code releases.

## Manual recovery

Use the prior digest from `previous-image.txt` only after confirming schema
compatibility. A code rollback does not undo migrations. For example:

```bash
sudo /opt/oxus_backend/deployment/deploy.sh production \
  ghcr.io/zhunus1/oxus_backend@sha256:<verified-previous-digest>
```

For Test, replace `production` with `test`. The script also makes a fresh Production
DB backup during a manually invoked release. A complete DB restore remains an
explicit maintenance operation, never a side effect of a branch push.

## First deployment on a new server

This CI installer expects the infrastructure and backend to exist already. For a new
server, copy `compose.yaml` and `.env.example`, create `.env` with server-specific
secrets, provide `jitsi-private-key.pk` readable by UID 1001, and initialize the stack
with `docker compose --env-file .env -f compose.yaml up -d`. Configure host Nginx/TLS
and verify application health before installing CI access. Use the separate Test
`nginx.conf` template only for Test; preserve Production's existing static landing
and `/storage/` bucket path. Do not overwrite a running server's `.env` or Jitsi key.

Sales / Expert demo seeds are manually invoked only; normal deployment does not seed demo records.
