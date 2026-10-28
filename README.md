# Aeroplane

Aeroplane is a self-hosted deployment control plane for running apps and databases on your own VPS. It connects to GitHub, builds projects with Railpack and BuildKit, runs services with Docker, manages environment variables, writes Caddy routes for domains, and gives you a dashboard for deployments, logs, variables, database data, backups, and system updates.

## Overview

Aeroplane is designed for small teams and personal infrastructure where you want Railway-like workflows without giving up control of the server.

It currently supports:

- GitHub-connected projects and services.
- Manual and push-triggered deployments.
- Railpack-based builds through BuildKit.
- Docker service orchestration with zero-downtime container swaps.
- Generated service domains from a wildcard root domain.
- Custom domains through Caddy.
- Environment variable management.
- PostgreSQL with optional PostGIS, Redis, and MongoDB services.
- Existing PostgreSQL/PostGIS connections with table editing and SQL access.
- Database browsing, editing, SQL console support where applicable, and backups.
- Scoped API keys for programmatic access to project and service endpoints.

## Installation

On a fresh Ubuntu/Debian VPS, run:

```bash
curl -fsSL https://get.aeroplane.run | sh
```

The installer creates `/opt/aeroplane`, clones this repository into `/opt/aeroplane/source`, writes a production `.env`, builds Aeroplane locally, and starts:

- `aeroplane` as a systemd service from the Git checkout
- `deploy-buildkit` on `127.0.0.1:1234`
- `deploy-caddy` on host ports `80` and `443`

After installation, open the printed URL and complete onboarding in the browser.

During onboarding you can set a dashboard domain, for example `pilot.example.com`. Point that hostname at the VPS and Aeroplane will write the Caddy route for the control plane. The raw `http://IP:4310` URL remains available as a fallback.

### Install Options

You can override installer defaults by passing environment variables to `sh`:

```bash
curl -fsSL https://get.aeroplane.run | \
  AEROPLANE_PUBLIC_URL=https://pilot.example.com \
  AEROPLANE_REPO_BRANCH=main \
  AEROPLANE_PORT=4310 \
  sh
```

Common options:

- `AEROPLANE_HOME`: install directory, default `/opt/aeroplane`
- `AEROPLANE_REPO_URL`: Git repository to clone, default `https://github.com/xt42io/aeroplane.git`
- `AEROPLANE_REPO_BRANCH`: Git branch to install and update from, default `main`
- `AEROPLANE_PUBLIC_URL`: public URL written to `PUBLIC_URL`
- `AEROPLANE_PORT`: control-plane port, default `4310`

### Managing The Install

On the VPS:

```bash
sudo journalctl -u aeroplane -f
cd /opt/aeroplane/source && git status
cd /opt/aeroplane && sudo docker compose logs -f caddy buildkit
```

If UFW is enabled, allow the public ports:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 4310/tcp
```

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

For UI-only work, set this in `.env`:

```bash
DEPLOY_DRY_RUN=true
```

For real local deployments, start the host services:

```bash
docker compose up -d
```

Then use:

```bash
BUILDKIT_HOST=tcp://127.0.0.1:1234
CADDY_CONFIG_PATH=./data/Caddyfile
CADDY_DATA_DIR=/srv/deploy-data
CADDY_RELOAD_CMD=true
DEPLOY_DRY_RUN=false
```

## GitHub App

Aeroplane works best with a GitHub App. Create one with these repository permissions:

- `Contents: Read`
- `Metadata: Read`

Subscribe it to the `Push` webhook event and point the webhook URL at:

```txt
https://YOUR_PUBLIC_HOST/api/github/app/webhook
```

The app details can be entered during onboarding or later in system settings.

## API Access

Create API keys from System Settings -> API Access.

Keys can be read-only or read/write, scoped to all projects or specific projects, and set to expire after 7, 30, or 90 days, or never expire.

Use API keys with bearer authentication:

```bash
curl "$AEROPLANE_URL/api/projects" \
  -H "Authorization: Bearer $AEROPLANE_API_KEY"
```

API keys use the same `/api/*` endpoints as the dashboard. Sensitive system settings and key management remain browser-session only.

## Domains

Set a dashboard domain in onboarding or system settings to serve Aeroplane itself through Caddy:

```txt
A     pilot.example.com     YOUR_SERVER_IPV4
AAAA  pilot.example.com     YOUR_SERVER_IPV6
```

Set a wildcard root domain in onboarding or system settings to generate service hostnames automatically.

Example:

```txt
Wildcard root domain: *.pilot.example.com
Service URL: api.pilot.example.com
```

For custom domains, point DNS at the VPS:

```txt
A     app.example.com     YOUR_SERVER_IPV4
AAAA  app.example.com     YOUR_SERVER_IPV6
```

Caddy handles routing and certificates once DNS resolves to the server.

## Stack

- TypeScript
- React + Vite
- Hono on Node.js
- SQLite + Drizzle
- Railpack + BuildKit
- Docker Engine
- Caddy

## Security Note

Aeroplane runs deployment workloads on your server through Docker. Only install it on infrastructure you control, and only grant access to trusted users.
