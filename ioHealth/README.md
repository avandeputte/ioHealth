# ioHealth sources

The documentation lives in the [repository README](../README.md). This folder holds:

| folder | what |
|---|---|
| `server/` | Python (FastAPI) service, shipped as the Docker image `ghcr.io/avandeputte/iohealth`, that receives uploads, writes MariaDB and serves the fitness web app (`static/`). Accounts come from the ioThing suite's shared `iothing-auth` library, as in ioPix, ioNotes and ioContacts. `app/` is the server (`upload.py` the phone's API, `webapi.py` the web app's, `db.py` the schema and migrations, `auth.py` the accounts), `tests/` runs against a real MariaDB (`python -m pytest tests`). `docker-compose.yml` builds it locally; `docker-compose.ghcr.yml` pulls the published image; `.env.example` lists the settings; `setup.sh`, `run.sh` and `update.sh` install, run and update it without Docker; `proxmox/` holds the Proxmox VE LXC installer (community-scripts layout, as ioPix, ioNotes and ioContacts) |
| `iOS/` | iPhone app: Health permission, per-type selection, anchored reads, batched uploads, background sync |
| `Shared/` | the upload line format (`SyncProtocol.swift`) and a SQLite wrapper used by the legacy Mac tools |
| `Mac/` | legacy macOS receiver that wrote SQLite over raw TCP; still builds, but the phone no longer uses it |
| `ExportImporter/` | macOS tool that imports the Health app's `export.zip` into SQLite |
| `project.yml` | XcodeGen spec: `xcodegen generate` produces `ioHealth.xcodeproj` with the iOS and Mac targets |
