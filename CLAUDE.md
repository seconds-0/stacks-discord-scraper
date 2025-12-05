# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a multi-project repository containing several independent projects:

```
Coding Projects/
├── frontend/          # React app (Create React App)
├── backend/           # Node.js backend (placeholder)
└── stacks-microtask/  # Stacks/Clarity smart contract tests

Coding-Projects/
├── slack-support-bot/ # Slack RAG bot (has its own CLAUDE.md)
└── speakeasy_deploy_*/
```

## Project-Specific Commands

### Coding Projects/frontend (React)
```bash
cd "Coding Projects/frontend"
npm install
npm start          # Dev server
npm test           # Run tests
npm run build      # Production build
```

### Coding Projects/stacks-microtask (Clarity Smart Contracts)
```bash
cd "Coding Projects/stacks-microtask"
npm install
npm test           # Run vitest (Clarinet SDK tests)
```
Uses `@hirosystems/clarinet-sdk` and `vitest-environment-clarinet` for testing Clarity smart contracts.

### Coding-Projects/slack-support-bot (Slack Bot)
See `Coding-Projects/slack-support-bot/CLAUDE.md` for detailed instructions. Quick reference:
```bash
cd Coding-Projects/slack-support-bot
npm install
node src/app.js                    # Run locally
npx eslint . --fix                 # Lint
npx prettier . --write             # Format
./deploy.sh                        # Deploy to Cloud Run
```

## Architecture Notes

### slack-support-bot
RAG-based Slack support bot using:
- **Slack Bolt** for event handling
- **LangChain** for RAG pipeline orchestration
- **Google Cloud**: Vertex AI (embeddings, vector search), Secret Manager, Cloud Run
- **Google Drive API** for document ingestion

Key paths:
- `src/app.js` - Main entry point
- `src/rag/` - Retriever and generator logic
- `src/config/` - Configuration and secrets loading
- `functions/ingestion/` - Cloud Function for document ingestion

### stacks-microtask
Clarity smart contract testing infrastructure using Clarinet SDK with Vitest. Tests run against simulated Stacks blockchain.
