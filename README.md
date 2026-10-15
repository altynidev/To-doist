# To-doist

A personal, fully local productivity hub — one website with:

| Section | What it does |
|---|---|
| **Dashboard** | Today at a glance: due tasks, today's schedule, today's habits, goal progress, a "vision of the day", quick note capture |
| **To-Do** | Lists, due dates, priorities, subtasks, repeating tasks, Today / Upcoming / All / Completed views |
| **Schedule** | Monday–Sunday timetable, one row per hour from 06:00 to 24:00; weekly-repeating or one-off plans, multi-hour blocks, "only this week" changes and skips, a live "now" line |
| **Notes** | Folders, pinning, colors, search, simple formatting (`# heading`, `**bold**`, `- [ ] checklist`) with preview |
| **Vision Board** | Multiple boards of images and affirmations, drag-and-drop images & reordering, full-screen "Present" mode |
| **Goals** | Categories, target dates, milestones *or* numeric targets, progress journal, linked habits, celebrations 🎉 |
| **Habits** | Weekly check-in grid, custom weekdays, streaks, 30-day consistency, 6-month heatmap |

## Run it

Requires Java 21+ (you have Java 25). No other installs, no internet needed.

- **Double-click `run.bat`**, or
- in IntelliJ, open `src/Main.java` and press **Run** (working directory must be the project folder — the default).

Your browser opens at <http://localhost:4321>. Keep the window running while you use the app; close it to stop.

Options: `run.bat --no-browser` doesn't open a browser tab. Set the env var `TODOIST_PORT` to use another port.

## AI assistant

Open **Assistant**, describe an idea ("I want to get fit before summer"), and it proposes goals, tasks,
schedule blocks, habits, notes and vision words. Untick what you don't want, then **Add selected**.
You can also ask it to change the plan ("move the gym to the evenings").

Choose the AI in **Settings → AI assistant**. Both options are free:

- **On this computer (Ollama)**: private, works offline. Needs the free [Ollama](https://ollama.com) app running
  and a model downloaded: `ollama pull qwen3:4b`.
- **Google Gemini**: smarter; needs internet and a free key from <https://aistudio.google.com/apikey>.
  The key is stored only in `data/gemini-key.txt`. On the free plan Google may use your prompts to improve its products.

## Use it on your phone

1. Start To-doist on the computer and open **Settings → Use on your phone → Turn on phone access**.
2. With the phone on the **same Wi-Fi**, scan the QR code (or type the link shown).
3. In the phone browser's menu choose **Add to Home screen** for an app icon.

The first time, Windows may ask whether Java may use networks. Allow **Private networks**.
The computer has to be on with To-doist running while you use the phone. Both devices save to the same
`data/data.json` and pick up each other's changes within ~10 seconds.

## Where your data lives

Everything stays on this computer in the `data/` folder:

- `data/data.json` — all your content (saved automatically ~0.4 s after every change)
- `data/backups/` — one automatic snapshot per day, last 30 kept
- `data/uploads/` — images added to vision boards

You can also export/import a backup file from **Settings**. Other devices on your network are refused unless
phone access is on *and* they opened the secret link (`data/phone-key.txt`). **New link** in Settings signs out every phone.

## Project layout

```
src/Main.java      tiny Java HTTP server (no dependencies): serves web/, saves data/
web/index.html     app shell
web/css/           styles (light + dark theme)
web/js/            store (saving), utils, and one module per section in js/views/
```
