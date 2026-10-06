# 📔 Günce

**A cozy journal you can keep alone or together.**

*Günce* is an old Turkish word for "diary". Everyone gets one personal journal, and you can start as many shared journals as you like with friends, partners or family. Write about your morning in your own journal, then write about tonight's dinner in the journal you share with the people you went with. Every member of a shared journal can add, edit and delete its memories.

Everything sits on a monthly calendar. Click a day to read or write. There is no year limit, so if you've kept paper diaries for years you can go back and type them in on the right dates.

> 🤖 **This project was vibe coded.** It was built by describing the idea in plain language to an AI coding assistant (Claude Code) and iterating on the result together. A person tested it and steered the design, but no one wrote it line by line. Read the code before you rely on it for anything important.

<p align="center">
  <img src="docs/screenshots/desktop.png" alt="Monthly calendar with the day panel open" width="860">
</p>

<p align="center">
  <img src="docs/screenshots/mobile.png" alt="Calendar on a phone" width="250">
  &nbsp;
  <img src="docs/screenshots/mobile-day.png" alt="A day on a phone" width="250">
</p>

## Features

**Journals**
- **One personal journal per person.** It's created when you sign up and only you can see it.
- **Unlimited shared journals.** Give each one a name, an emoji and a colour, then invite people with an 8-character code or a link (`/join/CODE`). Every member can write, edit and delete memories. The owner can remove members or generate a new code, which stops the old one from working.
- **"Everything together" view** merges all your journals on one calendar, coloured by journal.

**Calendar**
- **A calendar that never scrolls.** Every month is drawn as the same six-week grid, sized to fit the screen, so nothing jumps around between months.
- **As many chips as fit.** Each day shows coloured chips for its memories and a "+N" badge for the rest. On phones the chips become dots.
- **Any year from 1 to 9999.** Jump to any month or year from the picker. Dates are handled as plain strings, so 1987 behaves exactly like 2026.

**Memories**
- **What a memory holds:** an optional time, a mood emoji, a short title (up to 60 characters), an optional place and free text.
- **Short cards in the day panel.** Click a card to open the whole memory in a fixed-size dialog. Long text scrolls inside it, and you can edit or delete from there.
- **Shared memories** show who wrote them and who last edited them. A memory can be moved to another journal.
- **On this day.** The day panel lists what you wrote on the same date in other years.
- **Search** across titles, text and places.
- **JSON backup** of any journal.

**Comfort**
- **Collapsible panels.** Tabs on the panel edges collapse the sidebar to an emoji rail and hide or show the day panel. Your choice is remembered.
- **Turkish and English**, plus light, dark and automatic themes.
- **Works on phones and tablets.** The menu becomes a drawer and days and memories open as bottom sheets. You can add Günce to your home screen.
- **Keyboard shortcuts:** `←` `→` change month, `N` new memory, `/` search, `T` today, `[` toggle sidebar, `]` toggle day panel.
- **Stays in sync.** Open tabs refresh every 45 seconds and whenever you come back, so you see what friends added.

<p align="center">
  <img src="docs/screenshots/memory.png" alt="A memory opened from the day panel" width="420">
  &nbsp;
  <img src="docs/screenshots/shared-journal.png" alt="Shared journal settings with invite code" width="420">
</p>

<p align="center">
  <img src="docs/screenshots/dark.png" alt="Dark theme with the sidebar collapsed" width="860">
</p>

## Tech

Kept small on purpose:

| Part | Choice |
| --- | --- |
| Server | Node.js 20+, Express |
| Database | SQLite through `better-sqlite3`, stored in one file |
| Frontend | Plain HTML, CSS and ES modules. No framework and no build step |
| Auth | Username and password hashed with scrypt. Sessions are random tokens stored hashed, in an `HttpOnly` `SameSite=Lax` cookie |
| Tests | `node:test` API tests (`npm test`) |

```
server/
  index.js     starts the HTTP server
  app.js       routes, validation, auth
  db.js        schema and connection
public/
  index.html   app shell
  app.js       the whole UI
  i18n.js      Turkish + English strings
  styles.css   design tokens, layout, light/dark themes
test/
  api.test.js
```

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/yavuzkrm/gunce.git
cd gunce
npm install
npm start          # http://localhost:3000
npm test           # API tests
```

The database is created at `./data/gunce.db`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Folder that holds `gunce.db` |
| `DB_FILE` | – | Full path to the database file (overrides `DATA_DIR`) |
| `NODE_ENV` | – | Set to `production` to mark cookies `Secure` (HTTPS only) |

## Deploy

GitHub Pages only serves static files, and Günce needs a small server for accounts and shared journals. Any host that runs Node or Docker works. Railway is the easiest.

### Railway

1. Sign in at [railway.com](https://railway.com) with your GitHub account.
2. Go to **New Project → Deploy from GitHub repo** and pick this repository. The included `Dockerfile` and `railway.json` are used automatically.
3. Add a **volume** to the service and set its mount path to **`/data`**. You can do this from the command palette (**Ctrl/⌘ + K → Add Volume**) or by right-clicking the service. Without a volume, every deploy wipes the database.
4. Go to **Settings → Networking → Generate Domain**. Your site will be at `https://<something>.up.railway.app`.
5. Every push to `main` redeploys automatically.

The Docker image already sets `NODE_ENV=production` and `DATA_DIR=/data`, and Railway's health check uses `/api/health`.

> SQLite lives on one disk, so keep the service at **one replica**. That's plenty for friends and family.

### Docker anywhere

```bash
docker build -t gunce .
docker run -p 3000:3000 -v gunce-data:/data gunce
```

The image runs with `NODE_ENV=production`, so the session cookie needs HTTPS. To try it over plain `http://localhost`, add `-e NODE_ENV=development`.

### Backups

Everything is in one file: `/data/gunce.db`, plus `-wal`/`-shm` files while the app is running. Copy it while the app is stopped, or use `sqlite3 gunce.db ".backup backup.db"`. Members can also download each journal as JSON from its settings.

## API

All endpoints are under `/api`, and request and response bodies are JSON. Requests that change data must send `Content-Type: application/json`. Together with the `SameSite` cookie, this blocks cross-site form posts (CSRF).

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/register` · `/auth/login` · `/auth/logout` | |
| GET / PATCH / DELETE | `/me` | profile, password change, account deletion |
| GET / POST | `/journals` | list journals / create a shared one |
| PATCH / DELETE | `/journals/:id` | edit / delete (owner) |
| POST | `/journals/:id/invite` | new invite code (owner) |
| POST | `/journals/:id/leave` | leave; ownership passes to the longest-standing member |
| DELETE | `/journals/:id/members/:userId` | remove member (owner) |
| POST | `/join` | `{ code }` |
| GET | `/journals/:id/export` | JSON backup |
| GET | `/entries?journal=all\|ID&from=YYYY-MM-DD&to=YYYY-MM-DD` | entries in a range |
| GET | `/entries/search?q=` · `/entries/memories?date=` · `/stats` | |
| POST | `/journals/:id/entries` | new entry |
| PATCH / DELETE | `/entries/:id` | edit (can move to another journal) / delete |

## Privacy notes

- Passwords are never stored in plain text (scrypt with a per-user salt).
- Only members of a journal can read it. Personal journals are visible only to their owner.
- When you delete your account, your personal journal is deleted. Shared journals you own pass to the member who joined earliest, or are deleted if you were the only member. Entries you wrote in shared journals stay there, shown as "Former member".
- There is no email and no password reset yet. If someone forgets their password, the server admin has to help.

## Ideas for later

Photos on entries, reactions and comments, email-based password reset, real-time updates over WebSockets, and importing from other diary apps.

## License

This project is licensed under the [MIT License](LICENSE).
