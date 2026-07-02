# Docker Setup for Hormiga

This document logs how Docker Desktop was set up for local PostgreSQL hosting.
It serves as a reference if you need to reinstall or set this up on another machine (e.g. Monica's).

---

## Why Docker?

Hormiga uses PostgreSQL as its primary database. Running PostgreSQL inside Docker means:
- No system-level PostgreSQL install (cleaner, easier to remove)
- Identical setup to a real cloud PostgreSQL (Supabase, Neon, Railway all use Postgres)
- When you're ready for real cloud: change one connection string, zero code changes
- Easy to wipe and reset if something goes wrong

---

## Installation (Windows 11)

### Status at time of writing
- Docker was **not installed** (confirmed via `docker --version` → command not found)
- winget v1.28.220 was available

### Install command

Run this in PowerShell **as Administrator**:

```powershell
winget install Docker.DockerDesktop
```

After installation completes, **restart your machine**. Docker Desktop needs to hook into WSL2 (Windows Subsystem for Linux) which requires a reboot.

### Verify installation

After reboot, open a terminal and run:

```bash
docker --version
docker compose version
```

Both should print version numbers. If Docker Desktop isn't running (check system tray), start it first.

---

## PostgreSQL container for Hormiga

Once Docker is running, start a PostgreSQL container:

```bash
docker run -d \
  --name hormiga-db \
  --restart unless-stopped \
  -e POSTGRES_USER=hormiga \
  -e POSTGRES_PASSWORD=hormiga_dev \
  -e POSTGRES_DB=hormiga \
  -p 5432:5432 \
  postgres:16
```

**What this does:**
- `-d` — runs in background (detached)
- `--name hormiga-db` — container name for easy reference
- `--restart unless-stopped` — auto-starts when Docker Desktop starts
- `POSTGRES_USER/PASSWORD/DB` — database credentials (dev only, local machine)
- `-p 5432:5432` — exposes Postgres on the standard port
- `postgres:16` — official Postgres 16 image

### Verify the container is running

```bash
docker ps
```

Should show `hormiga-db` with status `Up`.

### Stop / start the container

```bash
docker stop hormiga-db
docker start hormiga-db
```

---

## Connection settings

Add these to your `settings.json` (under a `"database"` key — the app will read them):

```json
"database": {
  "url": "postgresql://hormiga:hormiga_dev@localhost:5432/hormiga"
}
```

The URL format is: `postgresql://USER:PASSWORD@HOST:PORT/DBNAME`

When you move to real cloud (Supabase etc.), you'll replace this URL with the one they give you. Nothing else changes.

---

## If you need to wipe and start over

```bash
docker stop hormiga-db
docker rm hormiga-db
docker volume prune   # removes all unused volumes (data gets deleted)
```

Then re-run the `docker run` command above.

---

## Setting up on another machine (e.g. Monica's)

1. Install Docker Desktop (same winget command above)
2. Restart
3. Run the `docker run` command above
4. Copy `settings.json` from your machine (or fill it in fresh)
5. Run `python backup.py --restore backups/hormiga_backup_XXXXX.json` to load data

---

## Troubleshooting

**Docker Desktop won't start / WSL2 error:**
Run in PowerShell as Admin:
```powershell
wsl --update
wsl --set-default-version 2
```
Then restart Docker Desktop.

**Port 5432 already in use:**
Something else is using Postgres. Either stop it, or change `-p 5432:5432` to `-p 5433:5432`
and update the connection URL to use port `5433`.

**Can't connect from the app:**
Make sure Docker Desktop is running (check system tray). The container only runs when Docker Desktop is active.
