# Repository Guidelines

Use this guide when contributing across the multiple subprojects in this repo. Paths with spaces (e.g., `Coding Projects/...`) require quotes when running commands.

## Project Structure & Module Organization
- `Coding-Projects/speakeasy_deploy_20250907_170444/`: Speakeasy real-time platform; `mediasoupServer/` (Fastify/WebRTC backend), client assets in `index.html`, `renderer.js`, `js/`, `stylesheets/`, and deployment artifacts (`docker-compose*.yml`, `Dockerfile.server`, `Caddyfile`, `Documentation/` runbooks).
- `Coding-Projects/slack-support-bot/`: Slack on-call RAG bot (`src/`), ingestion Cloud Function in `functions/ingestion/`, and operational docs under `docs/`.
- `Coding Projects/frontend/`: Create React App scaffold (`src/`, `public/`) with Jest/RTL tests.
- `Coding Projects/backend/` and `Coding Projects/stacks-microtask/`: Minimal Node backend stub and Clarity/Vitest testing plan notes.

## Build, Test, and Development Commands
- **Speakeasy server**: `cd Coding-Projects/speakeasy_deploy_20250907_170444/mediasoupServer && npm install`. Dev server `npm run dev`; production `npm start`; tests `npm test` / `npm run test:coverage`; migrations `npm run migrate` (status/down/reset also available). Use Node 22.19 per `package.json`.
- **Speakeasy deployment**: From repo root, use existing `docker-compose.yml` + `Dockerfile.server`; avoid ad-hoc containers (see `CLAUDE.md` and `Documentation/Runbooks` for sequences).
- **Slack bot**: `cd Coding-Projects/slack-support-bot && npm install && node src/app.js`. Lint/format with `npx eslint .` (Airbnb base) and `npx prettier --check .`.
- **Ingestion function**: `cd Coding-Projects/slack-support-bot/functions/ingestion && npm install`; deploy via `./deploy.sh` after setting GCP variables.
- **Frontend**: `cd "Coding Projects/frontend" && npm install`; `npm start` for local dev, `npm test` for Jest watch, `npm run build` for production bundle.

## Coding Style & Naming Conventions
- JavaScript throughout; Speakeasy uses ESM with semicolons and async/await; Slack bot is CommonJS but linted with Airbnb base; prefer 2-space indentation and 80–120 column awareness.
- Keep env vars UPPER_SNAKE_CASE; file and module names use kebab/camel case consistent with neighbors.
- Run Prettier config in `slack-support-bot` (`tabWidth: 2`, single quotes, trailing commas) before committing there.

## Testing Guidelines
- Speakeasy: Vitest (`npm test`) expects specs alongside source using `*.test.js`/`*.spec.js`; use `npm run test:coverage` for V8 coverage. Add integration tests around WebSocket handlers and migrations when possible.
- Frontend: Jest + React Testing Library via `npm test`; keep tests next to components (`src/App.test.js` pattern).
- Slack bot currently lacks automated tests—add unit tests for RAG helpers and interaction handlers if you touch them; until then, document manual verification steps.

## Commit & Pull Request Guidelines
- Follow existing log style: short, Title-Case imperatives (e.g., “Add comprehensive project documentation…”). One focused concern per commit.
- PRs should describe scope, linked issues, configs touched (`.env`, deployment scripts), and commands run (`npm test`, `npm run migrate`, docker steps). Include screenshots or logs for UI/UX or deployment changes.
- Update relevant docs (`Documentation/Runbooks`, `docs/`, or inline comments) whenever behavior or configs change.

## Security & Configuration Tips
- Never commit secrets or `.env` files. Speakeasy relies on `.env` values consumed by docker-compose and Fastify; the Slack bot requires tokens/IDs noted in `docs/deployment-guide.md` and `README.md`.
- Validate migrations and backups before deploy; for Speakeasy, avoid modifying `docker-compose.yml`/`Dockerfile.server` unless coordinated.
- When touching deployment scripts, keep them idempotent and tested in a sandbox before production use.
