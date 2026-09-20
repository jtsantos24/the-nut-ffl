# The Nutcast — setup guide

This adds a weekly AI-generated audio recap show ("The Nutcast") to the league site: a
▶ Play button on the homepage for the latest episode, plus a full archive under
**🎮 Games → The Nutcast Archive**.

## How it works

The site itself is still a static, no-backend page — it can't run AI or text-to-speech on its
own. So the actual generation happens once a week in a **GitHub Action** (free for public
repos, and for most private-repo usage too):

1. Every Tuesday morning, GitHub spins up a temporary machine and runs
   `scripts/generate-recap.mjs`.
2. That script opens your own live site in a hidden/headless browser and waits for it to load
   real Sleeper data — matchup scores, Power Rankings, FAAB betting lines, everything. It reuses
   the site's own math (via two small hooks added to `league_hub.html`:
   `buildWeekRecapFacts()` and `isRecapDataReady()`), so the recap can never disagree with what's
   shown on the site.
3. It sends those facts to Claude (Anthropic's API), which writes a script in the voice of an
   original announcer character, "Duke 'The Nutcracker' Callahan."
4. It sends that script to ElevenLabs, which turns it into an MP3.
5. It commits the MP3 and an updated `recaps/manifest.json` back to the repo. Once that push
   deploys, the new episode shows up on the site automatically.

Nothing runs in visitors' browsers except playing the finished MP3 — no API keys are ever
exposed to the public site.

## One-time setup

### 1. Get an Anthropic API key

- Go to <https://console.anthropic.com>, create an account if you don't have one, and add a
  small amount of billing credit (script generation costs roughly $0.01–0.03 per episode — see
  **Cost** below).
- Create an API key under **Settings → API Keys**.

### 2. Get an ElevenLabs API key and pick a voice

- Go to <https://elevenlabs.io> and create an account. The free tier includes some monthly
  characters; a paid **Starter** plan (a few dollars/month) is more than enough for one
  ~800-word episode a week.
- Grab your API key from **Profile → API Keys**.
- Browse **Voice Library** for a voice you like — something energetic and announcer-y suits
  "Duke the Nutcracker." Copy that voice's **Voice ID** (shown in its settings). If you skip
  this, the script falls back to a stock energetic voice ("Adam"), which works fine too.

### 3. Add the secrets to GitHub

In your repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from step 1 |
| `ELEVENLABS_API_KEY` | the key from step 2 |
| `ELEVENLABS_VOICE_ID` | *(optional)* the voice ID from step 2 |

### 4. Confirm the workflow has permission to push

`.github/workflows/weekly-recap.yml` already requests `contents: write`. If your repo has
**Settings → Actions → General → Workflow permissions** set to "Read repository contents
permission," switch it to **"Read and write permissions"** — otherwise the Action can generate
the episode but won't be able to commit it back.

### 5. Where the files go

Copy these into your repo (same layout as this download):

```
scripts/generate-recap.mjs
.github/workflows/weekly-recap.yml
package.json
recaps/manifest.json          (starter file — empty archive)
```

Along with the updated `index.html` (or whatever your site's entry file is named — the
workflow assumes `index.html`; change `SITE_ENTRY` in the workflow's `env:` if yours is
different).

If your repo already has a `package.json` (unlikely for a single-file static site, but just in
case), merge the `playwright` dependency and `generate-recap` script into it instead of
overwriting.

## Using it

- **It just runs.** Every Tuesday at 11:00 UTC, the Action generates the recap for whichever
  week most recently finished.
- **Run it on demand**: repo → **Actions** tab → **Weekly Nutcast Recap** → **Run workflow**.
  Leave "week" blank to do the same auto-detected week the schedule would, or type a week
  number to backfill an earlier week from this season.
- **Regenerate a week**: same manual run, but check the "force" box — otherwise the script
  skips any week that already has a published episode, so accidental double-runs are safe by
  default.
- **If it runs too early**: if Monday Night Football hasn't been scored by Sleeper yet, the
  script detects that (scores still showing 0) and exits cleanly without publishing anything —
  it'll pick the week up on the next run.

## Cost (rough)

For a 12-team league, one ~800–1000 word episode a week:

- **Claude (script)**: a few thousand input tokens (the week's data) + ~1,500 output tokens ≈
  **$0.01–0.03/week**.
- **ElevenLabs (audio)**: ~5,000–6,000 characters of script ≈ **a few hundred characters over
  a Starter plan's monthly allowance is unlikely** — one episode a week fits comfortably in the
  free or Starter tier (30,000 characters/month).

Realistically well under $1–2/month combined for a typical season.

## Customizing

- **The persona**: edit the `PERSONA` constant at the top of `scripts/generate-recap.mjs` —
  it's a plain-English character description, easy to adjust (name, tone, catchphrases).
- **The voice**: change `ELEVENLABS_VOICE_ID` (as a secret, or hardcode a default in the
  script).
- **The schedule**: edit the `cron` line in `.github/workflows/weekly-recap.yml` — it's UTC,
  so convert your preferred local time.
- **What the show is called**: "The Nutcast" appears in `league_hub.html` (search for
  "Nutcast") and in the script's persona text — rename in both places if you'd rather call it
  something else, or just literally "Weekly Recap" as originally described.
- **Which model writes it**: set `ANTHROPIC_MODEL` as a repo secret/variable if you want a
  different Claude model than the script's default — check
  <https://docs.claude.com/en/docs/about-claude/models> for current model IDs.

## Troubleshooting

- **Action fails at "Waiting for the site's live data"**: the headless browser couldn't get
  `isRecapDataReady()` to return true within 2 minutes — usually means the deployed site is
  erroring out fetching Sleeper data, or `SITE_ENTRY` points at the wrong file. Check the
  Action's log output, and try opening the live site yourself around the same time.
- **Action fails on the Anthropic or ElevenLabs step**: the log prints the API's error message
  and status code directly — most common causes are a missing/incorrect API key secret or
  ElevenLabs running out of monthly character quota.
- **New episode doesn't show up on the site**: confirm the commit from the Action actually
  landed on the branch your GitHub Pages deployment builds from, and that Pages has finished
  redeploying (check the repo's **Actions** and **Pages** tabs).
