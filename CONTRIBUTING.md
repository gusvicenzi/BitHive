# Contributing to BitHive

Use Node.js 24 LTS and npm. Read `AGENTS.md` for the conventions followed by contributors and coding agents.

1. Install with `npm ci` and run `npm run dev`.
2. Work against demo miners or mocked adapters. Never change a physical miner or erase personal data as part of an automated test.
3. Add meaningful unit tests for **every feature**, including later additions. Test successful behavior, important edge cases, and failures. Use integration tests for migrations, database persistence, validation, and configuration workflows. Tests must pass before the feature is complete.
4. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run check:translations`, and `npm run build`. Install Chromium once with `npx playwright install chromium`, then run `npm run test:e2e`.
5. Keep both READMEs aligned with actual behavior. Clearly separate planned work from implemented features. Do not claim hardware validation without an actual test.

## Device integrations

Consult upstream OpenAPI and implementation, not third-party examples alone. Normalize optional fields, preserve unknown capability states, reject arbitrary writes, and use bounded network requests. Do not use model names as universal safety guarantees. Compatibility fixtures must contain synthetic identifiers and no real credentials. Read after each attempted write; keep an uncertain outcome uncertain and never replay it automatically. Custom Starminer firmware requires separate physical validation.

## Database changes

Use an isolated `BITHIVE_DATA_DIR` for schema development. Run `npm run db:dev`, give the migration a meaningful name, inspect its SQL, and commit the schema and migration. Normal execution and CI use `migrate deploy`. Test a fresh database and an existing database upgrade without resetting it. Never edit a migration that has shipped; add a new one. Review retention and indexes when adding history tables.

## Translation changes

English is the base and fallback. Add text to `src/web/locales/en.json` and translate every new key in `pt-BR.json`. Keep interpolation placeholders identical. `npm run check:translations` verifies keys and placeholders. Use `Intl` for dates/numbers and semantic labels for controls. Do not translate source identifiers or device values. Add UI tests for meaningful user-visible changes.

## Pull requests and licensing

Explain the concrete problem, resulting behavior, tests, and remaining compatibility limits. Keep credentials, databases, screenshots of personal data, and generated build files out of commits. The lockfile belongs in source control. No license is selected yet: do not add a license or publish this code without the owner's choice. GitHub templates and CI are prepared locally and require an eventual repository before hosted use.
