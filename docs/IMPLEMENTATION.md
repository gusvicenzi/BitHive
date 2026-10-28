# Implementation plan and decisions

1. Inspect the existing folder and applicable instructions, preserving existing files. The target folder was empty.
2. Verify official ESP-Miner routes, field names, units, readback semantics, and optional ASIC metadata. Research the owner's Starminer 601 separately.
3. Implement one local server, SQLite migrations, validated device adapters, bounded collection and retention, redacted audits, and demonstration miners.
4. Implement comparison, historical charts, manual settings and saved operating profiles, per-device batch results, and full English/Portuguese interfaces.
5. Verify unit/integration tests, production startup, browser smoke tests, accessibility basics, translation parity, and Windows/macOS CI configuration. Prepare bilingual contributor documentation.

## Interface direction

A compact control room for home miners: deep ocean `#123c50` navigation, mineral blue `#236583` readings, honey amber `#e5ac36` for uncertainty and identity, slate `#637a87` utility text, mist `#eef3f5` background, and white panels. Avenir Next/Segoe UI system fonts provide readable controls; SF Mono/Consolas align numeric comparisons. No web fonts or remote assets. A small hexagonal brand mark is the only decorative motif. Availability, freshness, and units are explicit.

## Compatibility evidence (reviewed 2026-10-14)

- [Official ESP-Miner OpenAPI](https://github.com/bitaxeorg/ESP-Miner/blob/master/main/http_server/openapi.yaml)
- [Official HTTP implementation](https://github.com/bitaxeorg/ESP-Miner/blob/master/main/http_server/http_server.c)
- [Official releases](https://github.com/bitaxeorg/ESP-Miner/releases)
- [Starminer manufacturer firmware page](https://ustarminer.com/pages/firmware-update)

The owner uses a Starminer Bitaxe 601 with customized AxeOS. Its manufacturer page supplies firmware but does not establish the entire API contract. A similarly named public fork is not evidence for the owner's exact firmware. On 2026-10-14 the actual device successfully responded to the existing adapter: model GammaV2, board 601a-4, firmware V1.0.1-rc.10. Read-only identity, metrics, ASIC capabilities, local registration, and metric persistence were verified. No PATCH commands were sent; physical configuration compatibility remains unverified. The reported frequency/voltage presets differ from its current custom operating settings, so BitHive retains the current values without treating them as advertised choices. This observation does not establish safe operating limits or compatibility with other firmware builds. No IP, MAC, payout identifier, or password from the device is included in these documentation notes.

BitHive reads `GET /api/system/info`, optionally reads `GET /api/system/asic`, and writes `PATCH /api/system`. Readings use GH/s and W, with efficiency derived as W × 1000 / GH/s. Missing metrics remain absent. Unsupported/invalid ASIC metadata leaves frequency and voltage controls read-only. Settings are restricted to reported options and observable fields. A readable field is a candidate capability, not proof of a working write; readback establishes each write's result.

Legacy flat primary/fallback settings and modern pool slots have separate payload mappings. Modern writes target the reported primaryPoolIndex or secondaryPoolIndex, preserve validated slot metadata and use the upstream password-preservation marker for an omitted password. Missing, duplicate, unknown or aliased secondary slots never enable fallback writes or fall back to flat legacy fields. Each destination has separate profile loading, values and password drafts. Portable profiles use an account-only JSON payload with a compatibility reader for legacy worker-bearing payloads; no table migration is required. Both passwords are excluded from snapshots and audits; changes are recorded as boolean markers. No firmware changes, OTA, Wi-Fi modifications, arbitrary slot selection, forced fallback or protection controls are exposed. Restarts are now an explicit, separately audited per-device action.

Fallback contracts were checked against the official v2.12.0 OpenAPI, HTTP settings handler and NVS REST-name mapping, plus the current slot API, update_pool_nvs and system_api_json implementation on 2026-10-28. Fixtures cover legacy fields and distinct/non-sequential secondary slots, metadata and password preservation, rejected ambiguous mappings, persistence and uncertain-write readback. Custom firmware fallback writes have no physical validation; no connected miners were contacted during development.

- [Legacy API](https://github.com/bitaxeorg/ESP-Miner/blob/v2.12.0/main/http_server/openapi.yaml)
- [Legacy settings handler](https://github.com/bitaxeorg/ESP-Miner/blob/v2.12.0/main/http_server/http_server.c)
- [Legacy REST-name mapping](https://github.com/bitaxeorg/ESP-Miner/blob/v2.12.0/main/nvs_config.c)
- [Current slot serialization](https://github.com/bitaxeorg/ESP-Miner/blob/master/main/http_server/system_api_json.c)

## Data and command behavior

Network traffic is restricted to RFC1918 IPv4 hosts on HTTP port 80. DNS is bounded and resolved addresses are validated and pinned per request. IPv6 and custom HTTP ports are planned. Four requests/devices can run concurrently and all work for a device is serialized. HTTP requests time out after five seconds; each reading can perform two HTTP requests. Collection runs every 15 seconds for responsive devices; failures back off to five minutes. Collection cycles never overlap. At most 100 due devices are scheduled in a cycle and 500 can be registered.

Configuration reads current capabilities immediately before writing, records a redacted attempt with unknown status **before** dispatch, sends once, and then reads state. Non-secret requested fields are compared exactly. Password changes remain unverified because the API cannot read them back. If acknowledgement is lost but public fields match, they can be verified; a missing or mismatched readback preserves uncertainty. Successful readback proves reported configuration, not sustained stable operation or payout correctness. A pending restart is never performed automatically.

Pool profiles use a separate global PoolProfile table with a committed additive migration, up to 100 unique named profiles. Only validated pool address, port and worker-free account are stored. Copying uses collected public snapshot settings without device requests. Loading a profile only fills the configuration draft; applying to primary or fallback uses the existing audited batch service and capability validation. Deleting a pool profile has no effect on miners. Passwords are neither accepted nor persisted in profiles.

Operating profiles store operating settings per device, up to 20 each. They are user-selected candidates, not claims of stability. Automatic tuning remains a typed extension point without a scheduler or actuator. This sequencing is intentional until hardware monitoring and manual configuration have been validated.

The local database uses atomic sample/device/event writes and indexed retention deletes. Samples expire after 30 days, connection events after 90 days, and configuration audits after 365 days. Histories return the latest 1,000 samples in the requested period, not downsampled full-range coverage. Per-device events and configuration changes are limited to the latest 100 each. History charts split missing readings and collection gaps. Saved profiles and device registrations have no age-based deletion.

## Dependency decisions

Prisma 6.19.3 retains a straightforward SQLite client without an additional native driver installation. `deepmerge-ts` is overridden to patched 8.x to address a recursive-merge advisory in the CLI dependency tree; generation, migration deployment, migration idempotence, and persistence are tested with the override. Review this override on future Prisma upgrades. ESLint 10 and Node.js 24 are used. The npm lockfile records the exact dependency graph.

## Miner naming

Registration uses the reported AxeOS hostname when no local label is supplied, with model/address fallbacks. Local display-name edits are device-serialized, audited, and never contact the miner. Existing names are not migrated. A label identical to the previous reported hostname follows future observed hostname changes; distinct custom labels are preserved. The hostname is also included in normalized settings and detected writable capabilities when reported.

AxeOS hostname updates are standalone single-device commands with lowercase DNS-label validation. The official HTTP implementation applies hostname changes to NVS and mDNS and may return a redirect; BitHive does not follow that redirect. For hostname-based registrations, the adapter resolves a private IPv4 address with the normal bounded DNS validation before dispatch, rejects collisions with another registration, and retains that address for readback and subsequent polls, even if the outcome is uncertain. Acknowledgement and verification follow the existing audited one-shot workflow. No schema migration or automatic rename of existing devices is required.

## Configuration drafts and explicit restarts

The configuration form overlays string drafts on current public snapshot values, retaining partially entered numeric values and edits across collection updates. Deltas compare typed values to the latest reading. Only changed single-device values are submitted; explicit profile fields remain included for selected batches so a profile can be applied to other miners even when the focused miner already matches. Native whole-form validation is disabled because untouched legacy values (such as an unused fallback port of zero) must not block unrelated changes; the strict settings schema validates the submitted delta. Dirty borders have a shared accessible unsaved-field description. Rejected changes retain drafts; attempted uncertain changes clear drafts and passwords to prevent casual replays. Passwords are always blank initially.

POST /api/devices/:id/restart accepts only an empty object and uses existing local-origin/header protections, device locks, concurrency budget and tuning exclusion. The service reads before dispatch, persists restartRequested before sending, calls POST /api/system/restart once, attempts readback, records acknowledgement/uncertainty/rejection or a lower uptime, and schedules a short collection retry after an unreachable read. A persisted 30-second event-based cooldown serializes duplicate requests across browser reloads. No startup or collector code automatically repeats restarts. UI restart feedback preserves known outcomes when a subsequent fleet refresh fails and can recognize a later uptime reset. Restart affects only the open miner even with a fleet selection.

Verified on 2026-10-28 against the official OpenAPI and HTTP implementation (current JSON acknowledgement and v2.12.0 plain-text acknowledgement); both send an acknowledgement before rebooting. No connected miner was restarted. Custom Starminer endpoint and physical reboot behavior remain independently unvalidated.

## Worker-agnostic pool profiles

Canonical profile JSON uses stratumAccount instead of stratumUser. Device normalization continues to expose actual stratumUser/fallbackStratumUser values. Copying device settings removes the last dot-delimited suffix; canonical accounts are never re-split during save or load, preserving dotted account bases. The repository converts legacy stored stratumUser payloads on read without mutating their source rows. Profile updates write only the new schema.

A profile preview composes account + '.' + hostname.toLowerCase().replace(/\s+/gu, ''). It uses reported AxeOS hostname only, never Device.name or the address. Missing/blank names and combined usernames over 255 characters fail closed. Profile-selected usernames remain read-only and follow hostname updates; explicitly clearing the selection restores manual control. Password drafts remain separate and are not stored in profiles.

Batch configuration accepts a strict optional poolAccounts object with primary/fallback account bases. Clients omit the corresponding raw user fields to avoid ambiguity; hostname writes cannot be mixed with account resolution. FleetService resolves each username after its fresh read under the existing device lock, validates capabilities, records the actual derived public settings in the audit and follows normal one-shot write/readback semantics. Each device gets its own worker, and missing names reject only that device. This changes business logic, not device endpoints or adapter payload mappings.
