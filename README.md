# Lost & Found, Campus

A campus lost-and-found board for Flame University. Students report a lost or
found item, browse and search the public feed, and see potential matches paired
automatically by the matching engine.

Built with Flask, SQLite, and vanilla HTML/CSS/JavaScript. Photos are compressed
in the browser and stored as data URLs in SQLite, so there is no external file
storage to configure.

## Run it

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5057>. The SQLite database (`lostfound.db`) is created
and seeded with 20 reports the first time the app starts. Delete the file to
reseed.

Set `PORT` to change the port (for example `$env:PORT=8080` in PowerShell), or
`LOSTFOUND_DB` to use a different database path.

## Sign-in

Sign-in is intentionally passwordless for this demo. Any valid
`@flame.edu.in` address is accepted, and the display name is derived from the
local part. The session is remembered in `localStorage`; there is no real
authentication or verification.

## Voice notes

The microphone button uses the browser's Web Speech API. Chrome and Edge
support it, and the page must be served from `localhost` or HTTPS. The first
press asks for microphone permission; if that is blocked, the interface says so
instead of failing silently.

When speech ends, the transcript is sent to `POST /api/refine`. The refiner
removes filler words, repairs common speech-to-text spellings, detects the
lost/found status and campus location, and splits the note into a title and
description. The fields are filled in for review before anything is published.

Refinement runs locally with no extra dependencies. If `OPENAI_API_KEY` is set,
the server tries a short OpenAI pass first and falls back to the local refiner on
any error. `OPENAI_REFINE_MODEL` overrides the default model. Transcripts are
not stored.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Validate a Flame email and return a display profile |
| `GET` | `/api/items?q=&status=&location=` | Search and filter reports |
| `GET` | `/api/items/<id>` | Fetch one report |
| `POST` | `/api/items` | Publish a report (`title`, `description`, `location`, `status`, `reporter_email`, optional `image` data URL) |
| `GET` | `/api/matches?email=&item_id=` | Potential lost/found pairs |
| `GET` | `/api/stats` | Board totals |
| `POST` | `/api/refine` | Turn a voice transcript into a report draft |

## Matching

Two reports can pair only when one is lost and the other found, and both share
a campus location. Titles and descriptions are tokenized, common words are
ignored, and synonyms are normalized (for example `macbook` to `laptop`,
`airpods` to `earphone`). Brand conflicts reject a pair. Confidence starts at
50 and rises with shared title and description terms; pairs below 60 are
hidden.

## Design

The interface uses a warm charcoal ground, a single muted brass accent, and
crisp 2px edges. Type is set in Fraunces for display, Instrument Sans for body
copy, and JetBrains Mono for labels and metadata. Entrance motion is used on
page and card load; there is no hover motion. The privacy note lives at
`#privacy` and is linked from the sidebar, footer, and sign-in dialog.

## Notes

- Uploads accept PNG, JPG, WEBP, or GIF and are capped at 3 MB after
  compression (12 MB source file).
- Fonts are self-hosted in `static/fonts/`. Seed photos are from Unsplash and
  stored in `static/img/`.
- `GET /privacy` serves the same single-page app so the policy can be linked
  directly.
