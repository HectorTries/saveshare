# Transcripts Template

When you paste a transcript, use this format:

```json
{
  "influencer_id": "james-money-stocker",
  "title": "My Portfolio Update - April 2026",
  "date": "2026-04-01",
  "type": "personal",  // or "advice"
  "tags": ["portfolio-update", "bitcoin"],
  "platform": "tiktok",
  "status": "complete",
  "url": "https://www.tiktok.com/@creator/video/1234567890",
  "duration": "60s",
  "author": "creatorhandle",
  "views": "7.4K",
  "video_id": "abc123",
  "published": false,
  "transcript": "Paste the full transcript here..."
}
```

I'll auto-generate the article from this!

---

## Field notes

- **`status`** — transcription lifecycle. `complete` = transcript is final, `draft` = still being edited. Sourced from the original CSV.
- **`published`** — whether the article based on this transcript has been rendered and pushed to `blog/`. Defaults to `false`; flip to `true` once the blog post is live. Separate from `status` so we can keep "transcription done" and "published to the site" as distinct signals.
- **`derived_articles`** *(optional)* — list of the blog posts that were generated from this transcript. Useful when one video feeds multiple blog posts at different angles (e.g. Sophie Blank's 60s video drives both the budget and net-worth posts).
- **`transcript_note`** *(optional)* — any caveats about the transcript (e.g. a missing middle section, a source-video reference).

## Workflow

1. Save the raw transcript JSON in `data/` with `published: false`.
2. Write the article source in `articles/`, render to `blog/`.
3. Flip `published: true` in the JSON.
4. Commit + push.
