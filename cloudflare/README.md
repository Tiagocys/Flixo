# MoneyPrinterTurbo Cloudflare Stack

This folder contains a minimal Cloudflare Pages + Workers scaffold for the prompt-to-video flow.

What it includes:

- A single-screen Pages UI with one prompt input.
- Pages Functions that act as the Worker/API layer.
- Supabase as the persistence layer for jobs and metadata.
- R2 support for generated assets and final MP4 storage.
- Optional bridge to the existing MoneyPrinterTurbo FastAPI backend.

## Local structure

- `pages/` - static frontend for Cloudflare Pages
- `functions/` - Pages Functions running on the Workers runtime
- `supabase/schema.sql` - starter schema for job storage
- `wrangler.toml` - local config template

## Environment variables

Required for production persistence:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `SUPABASE_SCHEMA` - default `public`
- `SUPABASE_TABLE` - default `video_jobs`
- `MONEYPRINTER_API_URL` - optional FastAPI backend URL, such as `https://api.example.com`
- `MONEYPRINTER_API_TOKEN` - optional bearer token for the backend
- `R2_PUBLIC_BASE_URL` - optional public base URL for generated assets

## ElevenLabs TTS

Keep the ElevenLabs API key on the Python backend, not in the browser:

```toml
[elevenlabs]
api_key = "your-elevenlabs-api-key"
model_id = "eleven_multilingual_v2"
```

In the Cloudflare UI, select `ElevenLabs` and enter a `Voice ID`. The Worker sends
the voice as `elevenlabs:{voice_id}:{name}`, which is the format expected by the
MoneyPrinterTurbo backend.

## Suggested deployment flow

1. Deploy the Pages site from `cloudflare/pages`.
2. Attach the Functions directory as the Worker runtime.
3. Create an R2 bucket for generated media.
4. Create the `video_jobs` table in Supabase using `supabase/schema.sql`.
5. Point `MONEYPRINTER_API_URL` to the existing MoneyPrinterTurbo backend if you want the Worker to dispatch real renders.
