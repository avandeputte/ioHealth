# ioHealth

Copies your Apple Health data, all of it or just the types you pick, into your own MariaDB database, and gives you a
fitness web app on top of it: dashboards, charts of any metric (stacked or overlaid), workouts with their GPS routes on
a map, sleep, training load and personal records. Nothing goes through a cloud service: an iPhone app uploads straight
to a small server that you run in Docker, over HTTPS behind your reverse proxy (or plain HTTP on your own network).
The same container serves the web app. Accounts are the ioThing suite's shared ones (the same as
[ioPix](https://github.com/avandeputte/iopix), [ioNotes](https://github.com/avandeputte/ionotes) and
[ioContacts](https://github.com/avandeputte/iocontacts)): every person in the household signs in with their own name
and sees only their own health data.

Health data only exists on the iPhone (on macOS, `HKHealthStore.isHealthDataAvailable()` is always `false`), which is
why there are two parts:

```
┌──────────────┐   HTTPS (REST, gzip NDJSON)   ┌───────────────┐        ┌──────────┐
│   ioHealth   │ ────────────────────────────▶ │ reverse proxy │ ─────▶ │  server  │ ──▶ MariaDB (health + auth)
│  (iPhone)    │                               │ (TLS)         │  HTTP  │ (Docker) │
└──────────────┘                               └───────────────┘        └──────────┘
```

| path | what |
|---|---|
| `ioHealth/server/` | Python (FastAPI) service, shipped as a Docker image, that receives the uploads, writes MariaDB and serves the web app (`static/`); accounts through the suite's [iothing-auth](https://github.com/avandeputte/iothing-auth) library, like ioPix, ioNotes and ioContacts |
| `ioHealth/iOS/` | the iPhone app |
| `ioHealth/Shared/` | the upload line format (`SyncProtocol.swift`) shared by the apps |
| `ioHealth/Mac/`, `ioHealth/ExportImporter/` | legacy macOS tools (a SQLite receiver the phone no longer talks to, and an importer for the Health app's `export.zip`) |
| `ioHealth/project.yml` | [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec that generates the Xcode project |
| `.github/workflows/receiver-image.yml` | runs the server's tests and builds and publishes its image |

## 1. Run the server

The server runs in any of three ways, as ioPix, ioNotes and ioContacts do; pick one:

| | how | where the settings live |
|---|---|---|
| [Docker](#docker-with-compose) | the image `ghcr.io/avandeputte/iohealth` with Compose or `docker run` | the compose file, `-e` flags or a `.env` file |
| [Proxmox VE (LXC)](#proxmox-ve-lxc) | one command on the Proxmox host creates a container and sets the server up inside it | `/opt/iohealth/app/.env` in the container |
| [Standalone](#standalone-any-linux-or-mac) | `setup.sh` on any Linux box or Mac: a Python virtual environment and a `systemd` service | `ioHealth/server/.env` |

Whichever way, it needs an existing MariaDB (or MySQL) server with two databases on it: one for the health data
(created if the user may; tables are created and migrated at every start) and the ioThing suite's shared **auth**
database, which holds the accounts for every app in the suite (also created at start; if ioPix, ioNotes or ioContacts
already runs, point ioHealth at the same one and the accounts are there already). It listens on port **47800**, for
both the phone's uploads and the web app; put it behind your reverse proxy for [HTTPS](#https).

### Configuration

All settings are environment variables (in the compose file, `-e` flags, or the `.env` file the LXC and standalone
installs write; `setup.sh` asks for the important ones); never commit real values.

| variable | required | meaning |
|---|---|---|
| `DB_HOST` | yes | MariaDB host name or IP |
| `DB_PORT` | no | default `3306` |
| `DB_USER`, `DB_PASSWORD` | yes | a user that may create tables in `DB_NAME` (and the database itself, ideally) |
| `DB_NAME` | no | default `health` |
| `IOTHING_AUTH_DB_HOST`, `IOTHING_AUTH_DB_PORT` | no | the server with the suite's shared account database; default: the same as `DB_HOST` / `DB_PORT` |
| `IOTHING_AUTH_DB_NAME`, `IOTHING_AUTH_DB_USER`, `IOTHING_AUTH_DB_PASSWORD` | yes | the shared account database (default name `auth`) and a user that may create tables in it |
| `IOTHING_COOKIE_DOMAIN` | no | the domain the session cookie is shared on (`example.com`): signed in at `photos.example.com` is signed in at `health.example.com` too; a LAN address gets its own cookie |
| `ADMIN_USER`, `ADMIN_PASSWORD` | no | the first account, created on a first start with an empty account database (or create it from the sign-in screen instead) |
| `DATA_OWNER` | upgrade | whose data was in the database before accounts, as an account name; default: the first suite admin. Only matters once, when upgrading from 1.x |
| `SYNC_TOKEN` | upgrade | the single upload token of 1.x: still accepted, for the `DATA_OWNER` account, so a phone set up before accounts keeps syncing. New phones use an app password; remove it to retire it |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | no | set both (and mount the files) to serve HTTPS directly instead of behind a proxy |
| `TZ` | no | fallback time zone (e.g. `Europe/Brussels`) for days and weeks; the browser sends its own, so this only matters for API calls without `tz` |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` | no | map tiles for routes, default OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) |
| `LISTEN_ADDR` | no | address the server listens on (inside the container, for Docker), default `:47800` |
| `AUTH_PROXY`… | no | sign-in at a reverse proxy or Cloudflare Access, see [HTTPS](#https) below |
| `UPDATE_CHECK` | no | `0`: never ask GitHub whether a newer version exists (the daily check, see [Updating](#updating)) |

### Docker: with Compose

The image is `ghcr.io/avandeputte/iohealth` (public, `linux/amd64` and `linux/arm64`). Versions up to 1.1.1 were
published as `ghcr.io/avandeputte/healthexport-receiver`; to upgrade, change the `image:` line and pull. Tags: `latest`
(current `main`), `2.0.0` and other release versions, and one tag per branch while it's being worked on.

Save this as `docker-compose.yml`, fill in the values, and run `docker compose up -d`. Every option the server
understands is listed (the same file is in the repo as `ioHealth/server/docker-compose.ghcr.yml`):

```yaml
services:
  iohealth:
    image: ghcr.io/avandeputte/iohealth:latest   # or a version such as 2.0.0
    container_name: iohealth
    restart: unless-stopped
    ports:
      - "47800:47800"                 # host:container; change the host side if 47800 is taken
    environment:
      # --- The health data: MariaDB / MySQL (required) ---
      DB_HOST: 192.168.1.10           # host name or IP of the database server
      DB_PORT: "3306"
      DB_USER: health
      DB_PASSWORD: change-me
      DB_NAME: health                 # created on first start if the user may; tables are always created/migrated
      # --- The accounts: the ioThing suite's shared auth database, as in ioPix, ioNotes and ioContacts ---
      # IOTHING_AUTH_DB_HOST: 192.168.1.10   # same server as DB_HOST unless set
      IOTHING_AUTH_DB_NAME: auth
      IOTHING_AUTH_DB_USER: auth
      IOTHING_AUTH_DB_PASSWORD: change-me
      # IOTHING_COOKIE_DOMAIN: example.com   # one sign-in for every app under the domain
      # ADMIN_USER: alex                     # the first account, on an empty auth database
      # ADMIN_PASSWORD: change-me-please
      # --- Upgrading from 1.x: whose data is already in the database, and the phone's old token ---
      # DATA_OWNER: alex                # default: the first suite admin
      # SYNC_TOKEN: the-old-token       # still accepted for the DATA_OWNER account; new phones use an app password
      # --- Optional ---
      TZ: Europe/Brussels             # fallback time zone for days and weeks; the browser normally sends its own
      # MAP_TILE_URL: https://tile.openstreetmap.org/{z}/{x}/{y}.png   # map tiles for workout routes
      # MAP_TILE_ATTRIBUTION: "&copy; OpenStreetMap contributors"
      # LISTEN_ADDR: ":47800"           # address:port inside the container
      # sign-in at Cloudflare Access (see HTTPS below): AUTH_PROXY: cloudflare, CF_ACCESS_TEAM, CF_ACCESS_AUD
      # Serve HTTPS directly instead of behind a reverse proxy: set both and mount the files below.
      # TLS_CERT_FILE: /certs/fullchain.pem
      # TLS_KEY_FILE: /certs/privkey.pem
    # volumes:
    #   - /path/to/certs:/certs:ro
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:47800/v1/health', timeout=4)"]
      interval: 30s
      timeout: 5s
      start_period: 30s
```

```sh
docker compose up -d
curl http://localhost:47800/v1/health        # {"ok":true,"schemaVersion":9}
```

Then open `http://localhost:47800/` and sign in (or, on an empty account database, create the first admin right
there). Update later with `docker compose pull && docker compose up -d`.

**Upgrading from 1.x** (the Go receiver, schema 8): the tables are kept and get a `user_id` column; every row that is
already there becomes the `DATA_OWNER` account's, so create that account first (`ADMIN_USER`/`ADMIN_PASSWORD`, or an
account that ioPix or ioNotes already made) or the server refuses to start until it knows whose data it is. `SYNC_TOKEN`
keeps working for that account, so the phone keeps syncing until you give it an app password. `WEB_PASSWORD` is gone:
the web app uses the accounts. The columns are added in place (`ALGORITHM=INSTANT`), so the upgrade takes seconds
even with years of data and is fine on a Galera cluster.

<details>
<summary>Keeping the secrets in a <code>.env</code> file instead</summary>

If you'd rather not have the passwords inside the compose file, replace the `environment:` block with
`env_file: .env` and put the settings in a `.env` next to it (`ioHealth/server/.env.example` is a template):

```yaml
services:
  iohealth:
    image: ghcr.io/avandeputte/iohealth:latest
    container_name: iohealth
    restart: unless-stopped
    ports:
      - "47800:47800"
    env_file: .env
```

```dotenv
# .env
DB_HOST=192.168.1.10
DB_PORT=3306
DB_USER=health
DB_PASSWORD=change-me
DB_NAME=health
IOTHING_AUTH_DB_NAME=auth
IOTHING_AUTH_DB_USER=auth
IOTHING_AUTH_DB_PASSWORD=change-me
# IOTHING_COOKIE_DOMAIN=example.com
# ADMIN_USER=alex
# ADMIN_PASSWORD=change-me-please
# DATA_OWNER=alex
# SYNC_TOKEN=the-old-token
# TZ=Europe/Brussels
# MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
# LISTEN_ADDR=:47800
# TLS_CERT_FILE=/certs/fullchain.pem
# TLS_KEY_FILE=/certs/privkey.pem
```
</details>

### Docker: with plain `docker run`

```sh
docker run -d --name iohealth --restart unless-stopped -p 47800:47800 \
  -e DB_HOST=192.168.1.10 -e DB_USER=health -e DB_PASSWORD=change-me -e DB_NAME=health \
  -e IOTHING_AUTH_DB_NAME=auth -e IOTHING_AUTH_DB_USER=auth -e IOTHING_AUTH_DB_PASSWORD=change-me \
  ghcr.io/avandeputte/iohealth:latest
docker logs -f iohealth
```

(or `--env-file .env` instead of the `-e` flags, with the `.env` shown above.) From a clone,
`cd ioHealth/server && docker compose up -d` builds the image locally instead of pulling it (`docker-compose.yml` has
`build: .`).

### Proxmox VE (LXC)

`ioHealth/server/proxmox/ct/iohealth.sh` and `proxmox/install/iohealth-install.sh` follow the community-scripts
(ProxmoxVE) framework layout, the same way as the other apps. On the Proxmox host, as root,

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/avandeputte/ioHealth/main/ioHealth/server/proxmox/ct/iohealth.sh)"
```

creates a small Debian 13 container (2 CPUs, 1 GB, 4 GB disk by default), puts the server in `/opt/iohealth/app` and
runs its `setup.sh` there. It asks, as the other apps' scripts do, for the MariaDB host, port, database, user and
password of the health data, the same for the suite's shared account database (the one ioPix, ioNotes and ioContacts
use), the cookie domain, the first account (only used when that database is still empty), and, when moving from
1.x, the account that owns the existing data and the old upload token (`SYNC_TOKEN`, so a phone set up before
accounts keeps syncing); then the time zone and the port (47800), after the framework's own questions (resources,
network). The passwords reach `setup.sh` through its environment (a root-only file pushed in and removed again),
never on a command line; the setup's output is kept in `/opt/iohealth/setup.log`. Stop the old receiver first: it
must not write while the database is migrated (the phone keeps its samples until the new address answers). The
MariaDB users must be allowed to connect from the container's address. For unattended runs `IOHEALTH_DB` and
`IOHEALTH_AUTH_DB` (`host:port/db:user:password`), `IOHEALTH_SYNC_TOKEN`, `IOHEALTH_DATA_OWNER`, `IOHEALTH_TZ`,
`IOHEALTH_PORT`, `IOHEALTH_COOKIE_DOMAIN`, `IOHEALTH_ADMIN` (`name:password`) and `IOHEALTH_UNATTENDED=1` in the
environment answer the questions in advance. `update` inside the container (or "Update now" in the web app) runs
`update.sh`.

### Standalone: any Linux or Mac

```sh
git clone https://github.com/avandeputte/ioHealth && cd ioHealth/ioHealth/server
./setup.sh          # asks for the databases, the port and the first account; installs a systemd service when run as root
./run.sh            # or start it in the foreground
./update.sh         # later: the latest code, same settings
```

`setup.sh` takes flags instead of questions (`--db`, `--auth-db`, `--data-owner`, `--tz`, `--port`,
`--cookie-domain`, `--admin`, `--yes`; the passwords can come from `IOHEALTH_DB`, `IOHEALTH_AUTH_DB`, `IOHEALTH_ADMIN`
and `IOHEALTH_SYNC_TOKEN` in the environment), writes `.env` (readable by the owner only), makes `.venv` (Python 3.11
or later), installs the `iohealth` systemd service and waits until it answers (on a 1.x database the first start
migrates it to accounts first). Without the service, `./run.sh` starts it in the foreground from the same `.env`; a
launchd job `net.iothing.iohealth.server` on a Mac can run that script, and "Update now" in the web app restarts
either. `python -m pytest tests` (after `pip install -e ".[test]"`) runs the tests against a real MariaDB
(`IOHEALTH_TEST_DB_HOST`, `_PORT`, `_USER`, `_PASSWORD`; default `127.0.0.1`, `health`/`health`; it makes and drops
databases of its own, `health_test`, `auth_test_iohealth` and `health_mig_test`, so the user needs `CREATE` and `DROP`).

### Updating

- **Docker:** `docker compose pull && docker compose up -d`.
- **Proxmox LXC:** `update` inside the container (the community-scripts command), which runs `update.sh` below.
- **Standalone:** `./update.sh` in `ioHealth/server` fetches the latest code (git, or the GitHub tarball when
  there is no checkout), installs the packages the new version asks for and only then moves the code in, then
  restarts the service. `--check` only reports; `IOHEALTH_REF=<sha>` installs that commit.
- **From the web app:** Maintenance › ioHealth version (admins) shows the installed version and commit, "Check for
  updates" compares it with GitHub's `main`, and "Update now" runs `update.sh` (in Docker it says to pull instead).
  A daily check (on by default; `UPDATE_CHECK=0` locks it off, Maintenance switches it off) shows admins a card when
  a newer version exists, with Update now right on it, as in ioPix and ioNotes. Only the public commit list is
  fetched; nothing about the install is sent.

### HTTPS

The server speaks plain HTTP; put it behind your reverse proxy for HTTPS. With Caddy, which gets a certificate by
itself:

```
health.example.com {
    reverse_proxy 192.168.1.10:47800
}
```

With nginx:

```nginx
server {
    listen 443 ssl;
    server_name health.example.com;
    # ssl_certificate / ssl_certificate_key …
    client_max_body_size 100m;     # batches are gzip-compressed and normally well under 1 MB
    proxy_read_timeout 300s;
    location / {
        proxy_pass http://192.168.1.10:47800;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # marks the session cookie Secure
    }
}
```

Traefik: route the host to port 47800 and raise the body limit if you use the buffering middleware. If the proxy runs
in the same Docker network, use `iohealth:47800` as the upstream. The phone allows plain `http://` only to local
network addresses; anything else must be `https://`.

When the proxy already makes people sign in (Cloudflare Access, Authelia, oauth2-proxy…), ioHealth takes that sign-in,
exactly as the other apps in the suite do: the proxy passes who signed in in a header, and ioHealth treats that person
as signed in when an account exists for them (matched on the account's email address, then its name). Set it up once
for the whole suite in Settings › Sign-in at the proxy (it's kept in the shared account database), or in the
environment, which wins: `AUTH_PROXY` (`cloudflare`, `haproxy`, `nginx`, `caddy`, `traefik` or `header`),
`AUTH_PROXY_HEADER`, `AUTH_PROXY_TRUSTED` (the addresses the proxy connects from), `AUTH_PROXY_CREATE` (`viewer`
or `editor` to create an account for someone new, `deny` for a "No access" page), and for Cloudflare Access
`CF_ACCESS_TEAM` and `CF_ACCESS_AUD` (the signed token Cloudflare adds to every request is checked against your
team's keys). The header is believed only from the proxy's own addresses. The iPhone's uploads carry an app password
instead, so for a server behind Cloudflare Access the upload paths (`/v1/`) need a bypass rule or a Cloudflare
service token.

## 2. Build and install the iPhone app

You need a Mac with Xcode 15 or later, an iPhone on iOS 17 or later, and an Apple developer team (a free Apple ID
works, but the app then has to be re-installed every 7 days).

```sh
brew install xcodegen        # once
git clone https://github.com/avandeputte/ioHealth && cd ioHealth/ioHealth
xcodegen generate
open ioHealth.xcodeproj
```

In Xcode select the **ioHealth** target → *Signing & Capabilities* → pick your Team (HealthKit and background
delivery are already enabled through the entitlements in `project.yml`), plug in your iPhone, choose it as the run
destination, and run.

## 3. Use it

1. On the iPhone, open **ioHealth**, tap **Allow access to Health data**, and on Apple's permission screen turn
   everything on. (What you actually sync is chosen separately in step 3, without asking again.)
2. Under **Server**, enter the server's URL (`https://health.example.com`, or `http://192.168.1.10:47800` at home)
   and an **app password** for your account: in the web app, Settings › Account › App passwords › New, named
   "iPhone" say; it's shown once, and kept in the iPhone's Keychain. (A phone set up before accounts keeps its old
   `SYNC_TOKEN` until you replace it.) **Test connection** checks the address; the app password is checked at the first sync.
3. Optionally open **Data types** and switch off what you don't want: types are grouped, searchable, and marked when
   the phone has no data for them.
4. Tap **Sync now**. A decade of Apple Watch data (a few million samples) takes a few minutes; keep the app open for
   the first sync.

Later syncs only send what's new or changed. Turn on **Send everything again** when the database is new or emptied.

**Automatic syncing.** With "Sync automatically" on (the default), the phone syncs as soon as the app is opened, and
iOS also wakes it in the background when new Health data arrives (HealthKit background delivery, roughly hourly, only
while the phone is unlocked) plus an occasional background-refresh slot. The server has to be reachable at that
moment; a missed or cut-short round costs nothing, because anchors only advance for batches the server has
acknowledged.

The account the app password belongs to must be an **editor** (or admin) in ioHealth; a viewer can look but not
upload. Everyone in the household gets their own account and their own app password, and the phones upload side by
side into the same database, each row tagged with its owner.

## 4. The web app

The fitness web app is built into the server. Open the server's address in a browser (`https://health.example.com`
or `http://192.168.1.10:47800`) and sign in: the sign-in screen is the suite's, with a tile per account (an account
without a password signs in with one click, on the home network only). It shows only the signed-in person's data, and
shows new data as soon as a sync finishes.

The menu is laid out as in ioPix: a sidebar with the pages in groups (Dashboard, Day, Metrics, Workouts; Analysis:
Correlations, Map, Records; Health: Sleep, Glucose), Settings and, for admins, Maintenance at its foot. On a wide
screen it stays docked beside the page, or its button puts it away (remembered) and the menu button slides it over
the page when needed. On phones the same pages are a bottom bar (Dashboard, Day, Metrics, Workouts) with the rest
under More.

**Accounts** are the ioThing suite's shared accounts ([iothing-auth](https://github.com/avandeputte/iothing-auth): one
MariaDB database shared with ioPix, ioNotes and ioContacts), so one name, password and session serve every app, and
someone signed in at `photos.example.com` is signed in at `health.example.com` too when the apps share a domain
(`IOTHING_COOKIE_DOMAIN`). What is ioHealth's own is kept per app: the role an account holds here, its settings and
its health data. A *suite admin* is admin in every app.

| who | can |
|---|---|
| not signed in | nothing but the sign-in screen (there is no shared data to look at) |
| **viewer** | see their own data, and their own settings, goals and app passwords |
| **editor** | plus upload: the iPhone app signs in with an app password of an editor |
| **admin** | plus accounts (Settings › Users: add people, their role here, make someone a suite admin) and the sign-in settings |

Settings › Account is where you change your password, make **app passwords** for the iPhone (one per phone, shown
once, revocable), and sign out everywhere. Sessions are random tokens in an HttpOnly cookie (`iothing_session`, shared
by the apps on the domain) valid for 30 days and renewed while in use; passwords are scrypt-hashed; wrong passwords
cost a growing wait.

| page | what's on it |
|---|---|
| **Dashboard** | today's Move/Exercise/Stand rings and the last week's, last night's sleep, 14-day blood glucose summary (when there is glucose data), cards for steps, energy, distance, resting heart rate, HRV, VO₂ max, weight, respiratory rate, blood oxygen… (today, 7-day average against the 4 weeks before, 60-day sparkline), recent workouts and weekly training time by activity; a **Heads-up** list (glucose time in range and lows over the last week, resting heart rate up or HRV down against your usual, no sync for a day, goal streaks, misses and trends) |
| **Day** | one day on one page: totals, rings, last night's sleep, workouts, and a timeline of glucose (with carbs), heart rate, steps and energy with sleep and workouts shaded. Previous/next and a date picker; days link here from the workout calendar, the sleep page and correlations |
| **Metrics** | chart any synced type over any range (today, yesterday, 7 days to all time, or custom dates), **zoom and pan** (on every chart: click and drag to move along the timeline, Shift-drag across the chart to zoom in, the mouse wheel, Ctrl/⌘ + scroll or a pinch to zoom, double-click to reset; the detail reloads to fit the view), grouped per sample, hour, day, week, month or year; activity rings too (Move, Exercise and Stand per day, their goals and % of goal); several metrics at once, either **stacked** (one chart each, cursors linked) or **overlaid** (one chart, an axis per unit); min/max bands; **compare** with the previous period or a year earlier (a dashed line, and the change in the table); goal lines; average/min/max/total/trend table. The URL keeps the selection, so a view can be bookmarked |
| **Workouts** | filter by activity and period; totals, a year calendar, time per week or month, training load (fitness, fatigue and form from heart-rate TRIMP), and the list |
| **Workout** | the route on a map coloured by pace, heart rate or elevation; heart rate, pace/speed, elevation and power over time (hovering moves a marker along the route); splits per km or mile; heart rate zones; best 400 m … marathon inside the workout; laps, segments and every statistic |
| **Map** | every GPS route of a period on one map, coloured by activity |
| **Sleep** | stages per night (click one for its timeline), averages, bedtime and wake time, consistency |
| **Glucose** | blood glucose from a CGM or meter: average, GMI (estimated A1c), time in/below/above range, variability (CV), low episodes; readings with your target band and optional overlays (heart rate, steps, carbohydrates, insulin, workouts…); the daily pattern (ambulatory glucose profile) and time in range per day; **glucose around workouts and meals**: the average change from an hour before to three hours after, per activity or per meal size (from logged carbohydrates), and each event's numbers. A workout's own page shows its glucose curve too. mg/dL or mmol/L and the target range are set in Settings |
| **Correlations** | pick two metrics and a period: a scatter plot of the days (click a dot for that day), the correlation, how much one explains the other and the best-fit line, same day or "the day before" (sleep, workouts or carbs, then the next day's glucose). Includes glucose time in range and variability per day and workout minutes. A table ranks what else goes with the second metric |
| **Records** | fastest running efforts from the GPS routes, best days, health bests, ring streaks, and bests per activity |
| **Settings** | in tabs, as in ioPix. *Display*: km or miles, light/dark theme, and which pages and metrics to show (turn off Sleep, Glucose or any metric you don't use and it disappears from the menu, the dashboard, Metrics and Records). *Health*: glucose unit and target range, maximum heart rate (default 220 − age from your date of birth), your profile. *Goals and alerts*: **goals** (any metric, at least or at most: 10,000 steps a day, weight at most 75 kg, 7.5 h of sleep…) and the thresholds for dashboard alerts. *Account*: password, app passwords for the iPhone, sign out everywhere. *Users* and *Sign-in at the proxy* for admins |
| **Maintenance** | admins: the installed version and commit with Check for updates / Update now and the daily check; the databases, schema version and table sizes, how far the hourly rollup has got, and the last upload of every account |

**Export.** The ⤓ CSV buttons download what a chart or table shows (Metrics, Day, glucose readings and responses,
workouts, sleep, correlations). ⤓ PDF in the header saves the current page through the print dialog, in light colours
without the menus.

**On your phone.** In Safari on the iPhone, Share → Add to Home Screen puts ioHealth on the home screen with its own
icon, opening full-screen like an app (Android: Chrome's menu → Install app). Sign in once there.

How the numbers are made: days and weeks (Monday to Sunday) follow the browser's time zone. Totals such as steps come
from the source that counted the most in each period, so an iPhone and a Watch counting the same steps aren't added
together. A night of sleep is everything from 18:00 to 18:00 the next day, taken from the app that recorded the most
sleep that night. Settings are stored in the database (`web_settings`, per account), so they follow you to every browser.

The web app's data comes from a JSON API under `/api/` (`types`, `series`, `workouts`, `workouts/{uuid}`, `routes`,
`sleep`, `glucose`, `activity`, `profile`, `records`, `records/efforts`, `status`, and `settings`, which also takes `PUT`; for admins `maintenance`,
`update`, `update/check`, `update/run` and `update/auto`), which also accepts an app password as a bearer token, for
scripts (`Authorization: Bearer iohealth-…`); it answers with that account's data. Map tiles load from OpenStreetMap in the browser; everything else (including the chart and map
libraries, [uPlot](https://github.com/leeoniya/uPlot) and [Leaflet](https://leafletjs.com)) is served by the
container.

## What you get

All tables are InnoDB/utf8mb4 with timestamps in UTC as `DATETIME(3)`, and every data row has a `user_id`: the
account it belongs to (its id in the shared account database's `users` table). `SELECT … WHERE user_id = 1` is one
person; the examples below are for everyone at once.

| table | contents |
|---|---|
| `samples` | every quantity and category sample: `type` (a short snake_case name: `heart_rate`, `step_count`, `sleep_analysis`, `vo2_max`…), `kind` (`quantity`/`category`/…), `value`, `unit`, `start_date`, `end_date`, `count` (more than 1 for samples some apps pre-aggregate), `text` (names for category values such as `asleep`, `deep`, `rem`, or audiogram points as JSON), `source_name` (the app or device that recorded it), `metadata_json` |
| `workouts`, `workout_statistics`, `workout_events`, `workout_activities` | workouts and their per-workout heart rate / distance / energy stats, laps and pauses, and multisport segments |
| `workout_route_points` | GPS traces (lat, lon, altitude, speed, course, accuracy) |
| `heartbeats` | beat-to-beat intervals behind HRV readings |
| `activity_summaries` | daily Move / Exercise / Stand rings and goals |
| `characteristics` | date of birth, biological sex, blood type, skin type, wheelchair use |
| `sample_hourly`, `sample_hourly_ready` | every type summed per UTC hour and source (sum, count, min, max), so charts and records over months or years read thousands of rows instead of millions; kept current by each sync |
| `web_settings` | ioHealth's settings, per account |
| `deleted_objects`, `sync_log`, `schema_version` | bookkeeping |

Every data table also has `inserted_at` (when the server first stored the row) and `updated_at` (when its values last
changed; equal to `inserted_at` until then), both UTC. Resending unchanged data touches neither. The lap, pause and
multisport rows of a workout are rewritten whenever the workout is resent, so theirs restart then. Rows written
before these columns existed (schema versions below 5) have `NULL`.

When the server first starts on schema 8 or later it fills `sample_hourly` for existing data in the background, one
type and one month per transaction (small enough for a Galera cluster to replicate comfortably); charts read `samples`
directly until each type is done, and the log says when it has finished. Schema 9 (ioHealth 2.0) adds `user_id`.

Two views report how long samples take to arrive (`inserted_at` minus the sample's `end_date`, in minutes, which
includes the Watch-to-iPhone hop): `sample_delay_by_type` (per type: count, min/avg/max delay, latest sample, latest
arrival) and `sample_delay_by_day` (the same per type and per day of arrival, UTC).

Type names are the HealthKit identifier without its prefix, in snake_case (`HKQuantityTypeIdentifierHeartRateVariabilitySDNN`
→ `heart_rate_variability_sdnn`); the phone and the server share the rule (`HealthTypes.storageName`,
`server/app/db.py`'s `storage_name`). Units are your Health app's preferred units (kg or lb, km or mi…) where Apple exposes them,
otherwise metric; the `unit` column always says which.

```sql
-- resting heart rate, last 30 days
SELECT DATE(start_date) d, ROUND(AVG(value)) bpm
FROM samples WHERE type = 'resting_heart_rate'
GROUP BY d ORDER BY d DESC LIMIT 30;

-- how long after a measurement it reaches the database, slowest types first
SELECT * FROM sample_delay_by_type ORDER BY avg_delay_min DESC;

-- the same, today only
SELECT * FROM sample_delay_by_day WHERE day = UTC_DATE() ORDER BY avg_delay_min DESC;

-- hours of sleep per night by stage
SELECT DATE(start_date - INTERVAL 12 HOUR) night, text stage,
       ROUND(SUM(TIMESTAMPDIFF(SECOND, start_date, end_date)) / 3600, 2) hours
FROM samples WHERE type = 'sleep_analysis'
GROUP BY night, stage ORDER BY night DESC;
```

## API

Every `/v1` call except `/v1/health` needs `Authorization: Bearer <app password>` of an editor or admin account
(or the 1.x `SYNC_TOKEN`, which stands for the `DATA_OWNER` account); what is sent becomes that account's. Errors
are JSON `{"error": "…"}` with 400, 401, 403, 404 or 413.

| request | body | reply |
|---|---|---|
| `GET /v1/health` | | `{"ok":true,"schemaVersion":N}` |
| `POST /v1/sessions` | `{"deviceName","systemVersion","fullResync"}` | 201 `{"sessionId":N}` |
| `POST /v1/sessions/{id}/items` | NDJSON lines as in `ioHealth/Shared/SyncProtocol.swift`, optionally `Content-Encoding: gzip`; header `X-Batch-Seq: n` | `{"applied":k}` |
| `POST /v1/sessions/{id}/finish` | `{"totalSent":N}` | `{"received":rows}` |

Each batch is committed in one transaction together with its sequence number, so a batch resent after a lost reply is
acknowledged (`"duplicate":true`) without being applied twice. Every write is an upsert keyed on HealthKit's UUIDs, so
resending anything is safe.

## Not included

- **ECGs**: the iPhone app doesn't request or send them (the voltage traces are most of the data by volume).
- **Vision prescriptions**: HealthKit only allows reading them one prescription at a time, with a separate prompt.
- **Clinical (FHIR) health records** need the separate "Clinical Health Records" entitlement, which Apple grants
  per app.
- Data the Watch has purged (very old raw samples that the phone never received).
