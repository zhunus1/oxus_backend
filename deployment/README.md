# Backend-only server deployment

This directory deploys the OxusEdu backend and its private infrastructure. It does not deploy the student, expert, or admin frontends.

The same application image is used in every environment. Runtime behavior comes from the server-only `.env` file: Test uses `STAGING=true`; Production must use `STAGING=false` and an immutable release tag.

## Included services

- NestJS backend on host loopback port `4000`
- PostgreSQL with a persistent volume
- Redis with a persistent volume
- MinIO with a persistent volume and loopback-only API/console ports
- Browserless Chrome on the private Compose network
- A one-shot Prisma migration service

Only host Nginx accepts public traffic. It forwards `/api` to the backend and `/storage/` to MinIO. All database, Redis, and Browserless ports remain private.

## First Test deployment

Push the repository changes to `main` and wait for the GitHub Actions workflow to publish:

```text
ghcr.io/zhunus1/oxus_backend:test
```

Copy this directory to `/opt/oxus_backend/deployment` on the Test server. Then create the server-only environment file:

```bash
cd /opt/oxus_backend/deployment
cp .env.example .env
chmod 600 .env
nano .env
```

Generate independent URL-safe secrets for JWT, PostgreSQL, Redis, and MinIO. `openssl rand -hex 32` produces a suitable value; run it separately for every secret.

The application reads the Jitsi private key during startup. Use the private key that belongs to the Test JaaS application. If Test JaaS is not configured yet, a temporary RSA key allows the backend to start, but meeting tokens will not work with JaaS:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jitsi-private-key.pk
chown 1001:1001 jitsi-private-key.pk
chmod 400 jitsi-private-key.pk
```

For a private GHCR package, create a GitHub token with `read:packages` only. Enter it without putting it in shell history:

```bash
read -rsp 'GHCR token: ' OXUS_GHCR_TOKEN
printf '%s' "$OXUS_GHCR_TOKEN" | docker login ghcr.io -u zhunus1 --password-stdin
unset OXUS_GHCR_TOKEN
```

Deploy and wait for the health check:

```bash
./deploy.sh
```

The expected final state is a healthy `backend`, `db`, `redis`, and `minio`; a running `chrome`; and a successfully exited `migrator`.

## Host Nginx and HTTPS

Install `nginx.conf` as a host configuration. Preserve the distribution default instead of deleting it:

```bash
cp nginx.conf /etc/nginx/conf.d/oxus-backend.conf
mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.disabled
nginx -t
systemctl reload nginx
```

After all three DNS records resolve to the Test server, install Certbot and request one certificate:

```bash
apt update
apt install -y certbot python3-certbot-nginx
certbot --nginx --redirect \
  -d test.oxusedu.com \
  -d expert.test.oxusedu.com \
  -d admin.test.oxusedu.com
```

Verify the public health endpoint:

```bash
curl -fsS https://test.oxusedu.com/api/v1/health
```

The root URL intentionally returns `503` until a frontend is deployed.

## Updating and rolling back

For the separate, manually invoked 36-lead Sales / Expert demo after deployment, see [Sales / Expert demo](sales-expert-demo.md). The normal deploy and migrator do not seed these records.

After a successful `main` build, update Test with:

```bash
cd /opt/oxus_backend/deployment
./deploy.sh
```

For rollback, change `BACKEND_IMAGE` in `.env` from `:test` to a previously published `:sha-<commit>` tag and run `./deploy.sh` again. Database migrations must remain backward-compatible with the selected application version.

Never run `docker compose down -v` on a server unless permanent deletion of PostgreSQL, Redis, and MinIO data is explicitly intended.
