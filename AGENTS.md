# BitHive contributor and agent conventions

- Preserve existing work. Do not touch user databases or connected miners during development.
- Every new feature, including future features, requires meaningful passing unit tests. Cover success, important edge cases, and failure behavior. Add integration tests for persistence, migrations, API validation, and configuration workflows. Keep the demonstration smoke test working.
- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run check:translations`, `npm run build`, and `npm run test:e2e` before delivery. Tests must not need miners or external services; install the Playwright browser once for smoke tests.
- Use Node.js 24 LTS and npm. Include `package-lock.json` when dependencies change.
- Consult upstream ESP-Miner OpenAPI **and implementation** before changing device calls. Customized Starminer firmware must be tested independently; do not infer compatibility from its marketing name or an unrelated fork.
- Keep routes, device adapters, collection, business logic, and persistence separate.
- Validate external data and write inputs. Treat device text as untrusted. Never store or log passwords. Do not enable Fastify body logging. Never forward arbitrary device settings.
- Maintain bounded concurrency, per-device serialization, timeouts, collection backoff, and clear stale states. Do not automatically retry configuration commands. Read state after every attempted write and record uncertainty.
- Never disable firmware protections or invent universal safe limits. Tuning has an interface only until monitoring and manual writes have physical-device validation. Any future tuner needs explicit per-device limits, persisted experiments and last stable profiles, sustained evaluation, and unreachable rollback reporting.
- Use Prisma and committed migrations. Normal startup uses `migrate deploy`; `migrate dev` is contributor-only. Never reset user data to fix a migration.
- All user-facing copy belongs in `src/web/locales`. English is the base and fallback. Update Brazilian Portuguese, placeholders, and translation checks together. Runtime assets stay local.
- Keep primary documentation and identifiers in English; maintain corresponding Portuguese user instructions. Keep implemented and planned capabilities clearly separated.
- Do not select a license, invent a repository URL, publish to GitHub, or contact anyone without user authorization.
