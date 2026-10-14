# BitHive

**A local control room for your Bitaxe fleet.** Monitor hashrate, power, temperature, and availability; compare devices; keep a local history; and apply manual pool and operating settings through the miners' existing AxeOS APIs.

[Português do Brasil](README.pt-BR.md)

BitHive is intended for home miners running one or more Bitaxe/ESP-Miner devices on their own network. The initial compatibility target is the owner's **Starminer Bitaxe 601 with customized AxeOS**, alongside official AxeOS. No firmware installation or modification is needed. Read-only monitoring was physically validated on 2026-10-14 against a Starminer reporting GammaV2, board 601a-4, firmware V1.0.1-rc.10. Configuration writes remain untested on physical hardware.

## Implemented in v0.1

- Register a miner by private IPv4 address or local hostname; automatically use its AxeOS name, and read its model, board, firmware, and MAC when available. Optionally assign a BitHive display name.
- Compare individual hashrate, power, efficiency, chip temperature, hash-error percentage, status, and last successful update. Real fleet totals exclude stale readings and simulated devices. Efficiency uses paired power/hashrate readings rather than averaging device efficiencies.
- Inspect local historical charts with labeled unit scales and reading/timestamp tooltips (hover, touch, or keyboard) for hashrate, power, and chip temperature, plus shares, errors, regulator temperature, uptime, fan speed, and best difficulty when reported.
- Collect metrics independently of browser sessions. A running Node server is required.
- Configure primary pool, account/payout/worker, and password using legacy or active-slot APIs. Payout formats are determined by the pool.
- Select device-reported frequency/voltage options and supported automatic/manual fan controls. Save and load named operating profiles per miner.
- Refresh or configure up to 50 selected miners with an individual result for each.
- English and complete Brazilian Portuguese UI, persisted language preference, localized numbers and dates.
- Three simulated miners with persisted configuration and explicit demo labels. No hardware, pool connection, or Bitcoin mining is performed in demo mode.
- Local SQLite persistence for readings, events, profiles, and redacted configuration audits.

### Planned, not implemented

Automatic tuning (only a strategy/experiment interface exists), persisted tuning experiments and last stable profiles, full-range history downsampling, fallback/multi-pool administration, IPv6, custom miner HTTP ports, discovery, authentication/remote access, firmware upgrades, profile deletion, and miner removal are future work. GIF demonstrations will be added to `docs/media/` after real workflows are recorded.

## Requirements

- **Node.js 24 LTS** and its bundled npm. `.nvmrc` is supplied for version managers.
- Git to clone the repository once its URL is assigned.
- macOS or Windows. Use Terminal on macOS or PowerShell/Windows Terminal on Windows. No Unix utilities, global Prisma, Docker, database server, or firmware tooling are required.
- Reachable miners on the same private IPv4 LAN for real monitoring. Hostnames must resolve through the operating system; `.local` resolution depends on local mDNS/Bonjour support. An IP works without mDNS.

Dependencies are installed from npm on first setup. After installation, runtime assets are bundled locally and normal startup does not require internet access. Demo mode is available without physical miners.

## Install and run

The repository URL has not been selected. Once it is available, clone it, enter the existing `bithive` directory, then run:

```sh
npm ci
npm start
```

Open **http://localhost:3080**. Keep the terminal running. Stop with Ctrl+C. Restarting preserves registered devices, profiles, history, and demo configuration.

`npm ci` installs the locked dependencies and generates Prisma Client. `npm start` generates the client, applies committed migrations with `prisma migrate deploy`, compiles TypeScript and the frontend, and launches **one Node.js/Fastify server** that serves both API and UI. Initial database creation is automatic. Startup never uses `migrate dev`, schema resets, or destructive synchronization.

The compiler and Prisma CLI are intentionally installed locally because normal startup uses them. Do not install with `--omit=dev` or suppress installation scripts for this distribution. Startup stops on migration/build failure instead of silently running an outdated application.

### First run

1. Choose **Try demo** to explore without hardware. The three simulated miners are clearly labeled and excluded from real fleet totals; clicking again refreshes them without adding duplicates.
2. Choose **Add miner**, enter its private address, such as `192.168.1.42`, or hostname, such as `bitaxe.local`. Enter a host only, without a URL, path, or port. Identity and the AxeOS name are read before registration completes. Leave the optional display name empty to use the AxeOS name (falling back to model or address when absent).
3. Select the miner's name to open history, reported statistics, operating controls, primary pool settings, and recent audit activity. Historical collection starts at registration; prior firmware history is not imported.
4. Leave fields empty to preserve current values. **Apply & verify** sends a single change and reads state again. A password is never displayed or stored by BitHive and cannot be verified through readback.
5. Select multiple rows to refresh or configure the group. Options shown originate from the opened miner; each target is checked separately and incompatible targets fail individually.
6. Save selected operating fields under a profile name to reuse them on that miner. Loading a profile only fills the form; applying it is a separate action. Profiles are not certified stable settings.

### Changing miner names

Open a miner's details and use **Miner names**. **BitHive display name** updates only the local label, including while the miner is offline, and records the edit in local history. **AxeOS name (hostname)** changes the actual miner setting through a single `PATCH /api/system` and verifies it by reading the miner again. Use 1–63 letters, numbers, or hyphens, starting and ending with a letter or number; input is normalized to lowercase. Do not include `.local`.

Changing the AxeOS hostname changes its network name. When a miner was registered by hostname, BitHive resolves and validates its private IPv4 address before the command and retains that IP for verification and subsequent collection. It refuses the change if that IP belongs to another registered miner. Hostname changes are individual actions and cannot be combined with other settings or applied to multiple miners at once. Unsupported firmware disables the hostname control. Unknown outcomes are reported and never automatically retried.

A display label matching the previous AxeOS hostname follows later hostname changes. Custom labels stay as entered; existing registered names are preserved. Demo miners support hostname edits and retain them across restarts. Physical Starminer rename commands have not been tested; the physical-device validation above covers reads only.

### Chart units and power supply estimates

Hashrate charts automatically use TH/s when any reading in the displayed history exceeds 1,000 GH/s. The chart title, Y-axis ruler, tooltip, and accessible readings use the same unit throughout the history; TH/s readings display three decimal places (for example, `1.712 TH/s`). Histories at or below the threshold retain GH/s. Stored data stays in GH/s. Power and temperature hover readings show exactly one decimal place. Best difficulty in miner details uses M/G/T with three decimal places; hover, focus, or tap to inspect the full localized number. If firmware supplies only an already shortened difficulty, the tooltip identifies the expanded value; precision omitted by the firmware cannot be recovered.

The **Power draw** card normally shows online miners' reported power. Enable **Include power supply losses** to show reported watts + estimated supply loss = estimated wall draw, with distinct colors for the loss and total. **Power supply efficiency (%)** defaults to **85%**, an editable assumption rather than a measurement. Estimated wall draw = reported miner power / (efficiency / 100); loss is the difference. At 85%, 56.7 W becomes approximately `56.7 + 10.0 = 66.7 W`. Efficiency must be greater than 0% and at most 100%. The displayed components are rounded consistently to add up.

The estimate uses one fleet-wide efficiency assumption. Missing or stale readings are excluded or marked partial, and demo miners remain outside real totals. This option does not change recorded power, miner configuration, device efficiency, or historical charts. The toggle and efficiency are saved in this browser; if browser storage is unavailable, they work for the current session.

## Compatibility and command semantics

The adapter verifies external responses at runtime and detects optional capabilities rather than assuming a device model supports everything. It uses the official system-info, optional ASIC-info, and settings endpoints. If usable frequency/voltage choices are unavailable, those controls stay read-only. Monitoring can continue with partial metrics.

Official AxeOS is supported through the reviewed API contract, including legacy flat primary-pool fields and modern primary pool slots. Read-only monitoring and capability detection were **validated on a physical Starminer 601** on 2026-10-14 (reported model GammaV2, board 601a-4, firmware V1.0.1-rc.10), including registration and local metric persistence. Physical configuration writes remain untested. A version or model name alone does not guarantee compatibility. See [API evidence and implementation decisions](docs/IMPLEMENTATION.md) for the inspected sources and limitations. When reporting a problem, include model/board and firmware versions, sanitized field names, and the failed action. Never upload passwords or full device dumps containing secrets.

Results distinguish **verified**, **not verified**, **unknown outcome**, and **failed**. Verification proves that the device reports the requested public values; it does not prove sustained hashrate, safety, stability, actual payout, or that a firmware restart is unnecessary. Acknowledged writes that do not appear in the subsequent response remain unverified. If a request times out, it is not retried automatically. Check AxeOS before sending it again. Some firmware may require a later restart, which this version does not initiate.

Modern pool edits preserve the active primary slot's validated fields and existing password when left blank. Other pool slots are not modified. Only supported settings are exposed: BitHive never disables thermal protections or changes firmware. API read access to a field is not proof of write capability; unsupported writes are detected through failure/readback.

## Architecture

```text
Browser: React + TypeScript + Vite + i18next
                    |
Local Fastify server: routes -> fleet service -> device adapters -> AxeOS HTTP
                                  |
                           Prisma -> SQLite
                                  |
                         background collector
```

`src/server/app.ts` owns API routing and browser request checks. Adapters normalize validated responses and map settings. The service serializes per-device work, caps concurrency at four, and manages configuration verification. The collector operates with no browser dependency. Persistence and retention live separately. Shared types and calculations are in `src/shared`. React renders comparison, history, manual control, and feedback without remote runtime assets.

Responsive devices are sampled approximately every 15 seconds; unavailable devices back off up to five minutes. Five-second timeouts apply to each HTTP request (a reading may make two), and response sizes are bounded. A failed observation immediately becomes stale; three consecutive failures mark a device offline. Readings older than 90 seconds are also stale. Old values remain visible with their last successful timestamp but do not contribute to current totals. Collection pauses when the machine sleeps or the server stops.

The server binds to `127.0.0.1`. Origin/Host validation and a custom write header protect local browser writes. There is no remote-access or user-account feature. Device traffic is HTTP on port 80, restricted to RFC1918 IPv4 addresses; hostname resolutions are validated and pinned for each request. Pool hostnames are sent as miner configuration and are not contacted by BitHive.

## Local data, backups, and upgrades

By default all application data is in **`data/bithive.db` inside the repository**. This directory and SQLite side files are ignored by Git. Pool passwords are sent directly to the miner, then discarded; only a `passwordChanged` marker is recorded. Local database files can still contain payout/account identifiers and should be treated as personal data.

Optional environment variables (no configuration file is required):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3080` | Production server port |
| `BITHIVE_DATA_DIR` | `<project>/data` | Directory for the SQLite database |

For an override, set variables using your shell's normal syntax before `npm start`. Development uses backend port 3080 and frontend port 5173; keep the default backend port in development.

To back up, stop BitHive with Ctrl+C and copy the **entire data directory** to a protected location. To restore, stop the app and replace that directory from the backup, then start normally. Do not copy a live SQLite file as a backup. Keep data outside the checkout with `BITHIVE_DATA_DIR` if replacing the whole project folder.

To upgrade: stop the server, back up data, update the source, run `npm ci`, then `npm start`. Committed migrations are applied in order and existing data is preserved. If deployment fails, stop and inspect the error; do not reset the database. Future destructive schema changes require explicit upgrade/migration planning.

Retention runs at startup and roughly hourly: metrics **30 days**, connection/action events **90 days**, configuration audits **365 days**. Profiles and device registrations remain. History requests allow 1–720 hours and return at most the latest **1,000 samples**, plus the latest 100 events and 100 configuration changes. Charts may therefore show only the recent part of a long selected period. Missing observations and large collection gaps break chart lines.

## Development and verification

```sh
npm ci
npm run dev
```

Open http://localhost:5173. The Node collector/API runs at 3080 and Vite proxies `/api` requests. Development also deploys committed migrations automatically.

```sh
npm test
npm run typecheck
npm run lint
npm run check:translations
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest tests device normalization, capabilities, calculations, concurrency, demo behavior, UI flows, error paths, database migration idempotence, retention, API validation, command uncertainty, redaction, profiles, and background collection. Integrations use isolated temporary SQLite databases. The Playwright smoke test starts the normal production server against an isolated temporary database and exercises demo registration, detail, configuration readback, language persistence, and mobile layout. No tests need internet access or physical miners once dependencies and the Playwright browser are installed.

Every new feature requires meaningful passing unit tests. Use `npm run test:watch` during development. GitHub Actions is configured to run the checks on macOS and Windows with Node 24; hosted workflow execution occurs after the repository is published.

Schema contributors can use `npm run db:dev` to create a migration, preferably against an isolated `BITHIVE_DATA_DIR`. Commit schema, migration SQL, and lockfile changes together. Use `npm run db:migrate` only to deploy existing committed migrations. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting

| Symptom | What to check |
|---|---|
| Wrong Node version | Install Node 24 LTS, reopen the terminal, and rerun `npm ci`. |
| Installation cannot reach npm | Check your internet/proxy for initial setup; runtime assets need no CDN. |
| Port 3080 in use | Stop the other process or set `PORT` for production. |
| Miner cannot be registered | Confirm its private IP, power, same-LAN reachability, and system-info endpoint in AxeOS. Try IP instead of `.local`. |
| Starminer fields differ | Monitoring tolerates missing fields; unknown operating options remain read-only. Provide sanitized firmware/model information for adapter updates. |
| Configuration is not verified | Reopen AxeOS and inspect actual state; allow firmware to settle. Never assume a timeout means nothing changed. |
| Manual fan field disabled | Select manual cooling first. Firmware must expose manual fan settings. |
| Empty charts | Keep the server running for at least two samples; select a period containing observations. |
| Stale or offline values | Last successful data remains visible. Check power/network and backoff; use a manual refresh after recovery. |
| Migration error | Check write access and free disk space, stop duplicate servers, and preserve a backup. Do not reset user data. |
| Browser test cannot launch | Run `npx playwright install chromium` once. |

## Contributing, translations, and license

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). User-facing text lives in `src/web/locales/en.json` and `pt-BR.json`; update both languages and preserve interpolation names. Dates and numbers use the selected locale. Do not embed device-provided HTML.

This source tree is prepared for a public open-source repository, but **no open-source license or repository URL has been selected**. `UNLICENSED` in package metadata documents this pending status; it does not grant redistribution rights. The owner must choose a license before open-source publication. No GitHub repository or publication is created by this implementation.
