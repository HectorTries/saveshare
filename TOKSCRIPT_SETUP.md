# TokScript API Integration

API Key saved: `sk_55a8f5b60de...`

## Test the API
```bash
curl -X POST "https://api.tokscript.io/v1/transcripts" \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username": "miarosemcgrath"}'
```

## Endpoints to try:
- `/v1/transcripts`
- `/v1/videos`  
- `/transcripts`
- `/api/v1/transcripts`

## Format needed from response:
```json
{
  "videos": [
    {
      "id": "...",
      "transcript": "...",
      "created_at": "...",
      "metrics": {"views": ...}
    }
  ]
}
```

## Next Steps:
1. If API works - we automate transcript fetching
2. If not - keep manual paste method

---

**Manual paste still works:** Just paste transcripts here and I'll create articles!