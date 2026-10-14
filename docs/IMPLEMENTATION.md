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

The owner uses a Starminer Bitaxe 601 with customized AxeOS. Its manufacturer page supplies firmware but does not establish the entire API contract. A similarly named public fork is not evidence for the owner's exact firmware. Physical compatibility is therefore **pending**, not certified.

BitHive reads `GET /api/system/info`, optionally reads `GET /api/system/asic`, and writes `PATCH /api/system`. Readings use GH/s and W, with efficiency derived as W × 1000 / GH/s. Missing metrics remain absent. Unsupported/invalid ASIC metadata leaves frequency and voltage controls read-only. Settings are restricted to reported options and observable fields. A readable field is a candidate capability, not proof of a working write; readback establishes each write's result.

Legacy flat pool settings and modern active-primary pool slots have separate payload mappings. Modern updates preserve validated slot fields, update only the primary slot, and use the upstream password-preservation marker for an omitted password. No firmware changes, OTA, restart, Wi-Fi modifications, fallback-pool management, or protection controls are exposed.

## Data and command behavior

Network traffic is restricted to RFC1918 IPv4 hosts on HTTP port 80. DNS is bounded and resolved addresses are validated and pinned per request. IPv6 and custom HTTP ports are planned. Four requests/devices can run concurrently and all work for a device is serialized. HTTP requests time out after five seconds; each reading can perform two HTTP requests. Collection runs every 15 seconds for responsive devices; failures back off to five minutes. Collection cycles never overlap. At most 100 due devices are scheduled in a cycle and 500 can be registered.

Configuration reads current capabilities immediately before writing, records a redacted attempt with unknown status **before** dispatch, sends once, and then reads state. Non-secret requested fields are compared exactly. Password changes remain unverified because the API cannot read them back. If acknowledgement is lost but public fields match, they can be verified; a missing or mismatched readback preserves uncertainty. Successful readback proves reported configuration, not sustained stable operation or payout correctness. A pending restart is never performed automatically.

Profiles store operating settings per device, up to 20 each. They are user-selected candidates, not claims of stability. Automatic tuning remains a typed extension point without a scheduler or actuator. This sequencing is intentional until hardware monitoring and manual configuration have been validated.

The local database uses atomic sample/device/event writes and indexed retention deletes. Samples expire after 30 days, connection events after 90 days, and configuration audits after 365 days. Histories return the latest 1,000 samples in the requested period, not downsampled full-range coverage. Per-device events and configuration changes are limited to the latest 100 each. History charts split missing readings and collection gaps. Saved profiles and device registrations have no age-based deletion.

## Dependency decisions

Prisma 6.19.3 retains a straightforward SQLite client without an additional native driver installation. `deepmerge-ts` is overridden to patched 8.x to address a recursive-merge advisory in the CLI dependency tree; generation, migration deployment, migration idempotence, and persistence are tested with the override. Review this override on future Prisma upgrades. ESLint 10 and Node.js 24 are used. The npm lockfile records the exact dependency graph.
