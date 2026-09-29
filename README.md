# Lightbulb

An idea bank built to beat procrastination. Say or type an idea into one bar; Lightbulb files it,
hands you a concrete first step, and keeps resurfacing ideas so they don't go stale. Later phases
send ideas to your agent (local or cloud), which offers options, returns a detailed plan for
approval, and only then builds.

**Done:** Phase 1 (accounts, capture, folder suggestion + confirmation, browse, search) and
Phase 2 (offline voice capture, the bar-first bank, next steps, Telegram bot).

## Stack

| Part | Tech |
|---|---|
| API | Node.js 20+, TypeScript, Fastify 5, Drizzle ORM, Zod 4 |
| Database | PostgreSQL (full-text search + `pg_trgm` duplicate detection) |
| Web | React 19, Vite, Tailwind CSS 4, Motion, TanStack Query, React Router 7, Phosphor icons |
| Suggestions | Claude API (structured output) with an offline heuristic fallback |
| Voice | whisper.cpp server, self-hosted in Docker; audio never leaves your machine |
| Telegram | grammY, long polling in dev, webhook in production |

npm workspaces:

```
apps/api          Fastify API (auth, folders, ideas, suggestions, voice, Telegram bot)
apps/web          React app
apps/runner       `lightbulb` CLI that runs ideas with the agents on your computer
packages/shared   Zod schemas + types shared by both
docker/whisper    Portable whisper.cpp server image
```

## Getting started

Requires Node 20+ and Docker.

```bash
npm install
cp .env.example .env
npm run services:up  # Postgres on :5433 + whisper on :8081 (first run compiles whisper, a few minutes)
npm run db:migrate
npm run dev          # API on :3001, web on http://localhost:5173
```

**Signing in during development:** with `SMTP_URL` empty, the magic link is printed to the
API log and the sign-in screen shows an "Open dev link" button. In production (`NODE_ENV=production`)
the link is only ever emailed.

**Folder suggestions and first steps:** set `ANTHROPIC_API_KEY` to get Claude suggestions
(`SUGGEST_MODEL`, default `claude-opus-5`, low effort, server-side refusal fallbacks). Without a
key, or if the call fails, an offline heuristic suggests folders and a first step (English or
Russian); the UI labels those "Quick guess".

**Voice:** the `whisper` container downloads its model on first start. `WHISPER_MODEL=base`
(~150 MB) is quick on CPU; `small` (~470 MB) is noticeably better for Russian and other
non-English speech. Language is detected automatically. The image is built from source for
AVX2 CPUs because the official image crashes on common hardware.

**Languages:** the whole interface is available in English and Russian (EN/RU switch in the
sidebar and on the sign-in page). The choice is saved to the account, so the Telegram bot and
sign-in emails follow it, and speech is recognised in that language by default; the recording strip
has its own EN/RU toggle for dictating in the other language. Whisper's auto-detection is not used
because it guesses wrong on short clips and writes Russian speech in Latin letters. Translations live
in `apps/web/src/i18n/` (`ru.ts` is type-checked against `en.ts`) and `apps/api/src/telegram/strings.ts`.

**Telegram:** create a bot with [@BotFather](https://t.me/BotFather), put the token in
`TELEGRAM_BOT_TOKEN`, restart the API, then press **Connect Telegram** in the sidebar. Send the
bot text or voice notes; it replies with the suggested folders as buttons. For production set
`TELEGRAM_WEBHOOK_URL` (public https URL of the API) and `TELEGRAM_WEBHOOK_SECRET`.

## How it works

1. **One bar.** Type or record into the bar on the bank page, or press `Ctrl/⌘ K` (or `/`) anywhere.
   While you type, it shows ideas you already have; if it looks like the same idea, it offers to
   pick that one up instead of starting over.
2. **Capture.** Saving puts the idea in the inbox immediately with a title, folder suggestions and a
   first step (one action of 15 minutes or less). Voice ideas keep their recording.
3. **Confirm.** Nothing is filed until you confirm: accept the suggested folder, pick an
   alternative, choose any folder, or create one. Suggested new folders are only created then.
4. **Keep moving.** "Pick one up" resurfaces the filed idea that has waited longest, with its next
   step and a Start button.
5. **The idea page** is deliberately *not* a free-form notebook. It has a fixed, capped structure so
   every addition moves the idea forward:
   - **Next step** card with a Done button: the first unchecked step of the checklist.
   - **Steps**: a checklist of up to 30 short items; finished ones fold away.
   - **The idea**: one short description (up to 4,000 characters).
   - **Notes**: short entries (up to 1,000 characters), typed or spoken, newest first.
   - **Photos and files**: up to 20 MB each and 50 per idea (1 GB per user); drag and drop, paste a
     screenshot, or attach. SVG/HTML and other types that could run as a page are refused.
   - From the bar, **Add to it** appends what you typed to an existing idea instead of creating a
     duplicate. In Telegram, **reply** to an idea message with text, voice, a photo or a file to add it.

6. **Hand it to an agent.** On the idea page, "Hand it to an agent" sends the idea to an agent that
   runs either in the **cloud** (on the Lightbulb server) or on **your computer**. The agent offers
   3-4 ways to build it; you pick one (optionally with a comment); it writes a detailed plan; you
   approve it, ask for changes, or pick another option. Only an approved plan gets built, and the
   server enforces that: approval names the exact plan version you read. The build streams live
   progress, and its next steps can be added to the idea's checklist with one click.

### Agents

**Your computer.** The `lightbulb` CLI (`apps/runner`) runs ideas with the agent CLIs installed on
that computer: Claude Code, Codex, Cursor CLI or Gemini CLI, each through its documented headless
mode. The server hands out the CLI with its own address built in:

```bash
curl -fsSL https://your-site/api/runner/cli -o lightbulb.cjs && node lightbulb.cjs
```

(On Windows: `iwr https://your-site/api/runner/cli -OutFile lightbulb.cjs; node lightbulb.cjs`.)
It shows a code and opens `/connect` to confirm it, like `gh auth login`; the computer then gets its
own token. It only makes outgoing HTTPS requests, long-polling for work like a GitHub Actions
runner. Each idea gets a folder under `~/Lightbulb` with its attachments. Options and plans run
read-only; builds may edit the project and run common dev tools (see `~/.lightbulb/config.json`
to change models, permission modes or the allowed tools). Needs Node.js 20+.
Build the CLI with `npm run build -w @lightbulb/runner` (included in `npm run build`).

**Cloud.** With `ANTHROPIC_API_KEY` set, options and plans come from the Claude API
(`AGENT_MODEL`, default `claude-opus-5`) and approved builds run on Claude Managed Agents with a
hard spending cap per build (`CLOUD_BUILD_BUDGET_USD`, default 5) and a daily limit per user
(`CLOUD_BUILDS_PER_DAY`, default 3). Deliverables (README, `project.zip`) are saved to the idea's
files. Set `CLOUD_AGENTS=false` to offer only users' own computers.

Uploads are stored on disk under `DATA_DIR` (default `apps/api/data`); swap `src/storage/files.ts`
for S3 when deploying beyond one server.

Deleting a folder never deletes ideas; they go back to the inbox.

## API

All routes are under `/api`, JSON in and out, and scoped to the signed-in user via an
httpOnly session cookie. Validation errors return `400 { error: "validation", issues }`.

| Method | Path | |
|---|---|---|
| GET | `/health` | `{ aiSuggestions, voice, telegram }` |
| POST | `/auth/magic-link` | `{ email }`, rate limited |
| POST | `/auth/verify` | `{ token }` → sets session cookie. Links are single-use, 15 min |
| GET | `/auth/me` | current user (`{ id, email, locale }`) |
| PATCH | `/auth/me` | `{ locale: "en" \| "ru" }` |
| POST | `/auth/logout` | |
| GET | `/folders` | folders with idea counts + bank counts |
| POST / PATCH / DELETE | `/folders[/:id]` | |
| GET | `/ideas?view=all\|inbox\|filed\|archive&folderId&q&cursor` | keyset pagination; `q` searches |
| GET | `/ideas/related?q=&exclude=` | ideas related to some text, each with a `duplicate` flag |
| GET | `/ideas/pick-up` | filed ideas with a next step, least recently touched first |
| POST | `/ideas` | `{ text, clipId? }` → idea in inbox with suggestion + next step |
| GET / PATCH / DELETE | `/ideas/:id` | PATCH: `title`, `body`, `nextStep`, `folderId` (null = inbox), `archived` |
| POST | `/ideas/:id/confirm` | `{ title?, target: { kind: "existing", folderId } \| { kind: "new", name, icon } }` |
| POST | `/ideas/:id/suggest` | re-run the suggestion |
| GET | `/ideas/:id/notebook` | `{ steps, notes, files }` for the idea page |
| POST | `/ideas/:id/steps` | `{ text }` (≤200 chars, ≤30 per idea) |
| PATCH / DELETE | `/steps/:id` | PATCH: `text`, `done` |
| POST | `/steps/:id/next` | move a step to the top (makes it the next step) |
| POST | `/ideas/:id/notes` | `{ text, clipId? }` (≤1,000 chars) |
| DELETE | `/notes/:id` | |
| GET | `/notes/:id/audio` | a voice note's recording |
| POST | `/ideas/:id/files` | multipart `file`, ≤20 MB |
| GET / DELETE | `/files/:id` | images inline, other files as downloads |
| POST | `/voice/transcribe?language=en\|ru` | multipart `file` (webm/ogg/m4a/mp3/wav, ≤12 MB) → `{ clipId, text }`; language defaults to the account's |
| GET | `/ideas/:id/audio` | the original recording |
| GET | `/telegram/status` | `{ linked, botUsername }` |
| POST / DELETE | `/telegram/link` | one-time `t.me` link (10 min) / disconnect |
| POST | `/telegram/webhook` | Telegram updates, webhook mode only |

## Scripts

| | |
|---|---|
| `npm run dev` | API + web with reload |
| `npm run services:up` | Postgres + whisper (`db:up`, `voice:up` for one) |
| `npm run build` | API bundle (`apps/api/dist`) + web build (`apps/web/dist`) |
| `npm run typecheck` | all workspaces |
| `npm test` | API unit tests (Vitest) |
| `npm run db:generate` | new migration from `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | apply migrations |

## Design

"Filament": cool neutrals with one warm-yellow accent, Geist type, light and dark themes
(follows the system, toggle in the sidebar). The bar is the centre of the bank page with a side
rail for momentum; its ring lights up as you type and pulses with your voice while recording.
Shape rule: cards 20px, fields 14px, buttons and chips fully rounded. All motion respects
`prefers-reduced-motion`.

## Roadmap

- **Phase 3 (done):** the agent loop in the cloud or on your computer (`lightbulb` CLI).
- **Phase 4:** a desktop app version of the runner, plus a Lightbulb skill for popular agents
  (Claude Code, Codex, Cursor and others) that teaches them the options → plan → approval
  protocol. To be designed together.
- **Phase 5:** Telegram approvals, usage limits, background job queue.
