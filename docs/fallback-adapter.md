# Fallback adapter contract

Use this only if a Hayase platform cannot reach Anime365 through its extension CORS bridge. It is deliberately stateless: no database, queue, authentication relay, or cache is needed for the MVP.

Configure the extension option `adapterUrl` with an HTTPS endpoint. Hayase calls:

```text
GET {adapterUrl}?anilistId=154587&episode=8
```

The endpoint must return HTTP 200 and a JSON array of direct subtitle files:

```json
[
  { "url": "https://files.example/frieren-08.ass", "language": "RU" }
]
```

The adapter owns Anime365 fetching, matching and any CORS workaround. It must never return a page URL, only a downloadable subtitle file URL. This keeps the Hayase extension unchanged and lets a future tiny edge function replace direct Anime365 calls without creating a server state or database.
