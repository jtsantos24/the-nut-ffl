#!/usr/bin/env node
// -----------------------------------------------------------------------------------------
// THE NUTCAST -- weekly AI audio recap generator
// -----------------------------------------------------------------------------------------
// Run by .github/workflows/weekly-recap.yml every week (plus available on demand). It:
//   1. Serves the repo's own index.html locally and drives it with a headless browser, so it
//      reuses the site's REAL Power Rankings / matchup-spread / FAAB-betting math instead of
//      re-implementing it in Node (see buildWeekRecapFacts() / isRecapDataReady() in
//      league_hub.html for the data contract this depends on).
//   2. Sends those facts to Claude (Anthropic API) to write a script in "Duke 'The Nutcracker'
//      Callahan" 's voice.
//   3. Sends that script to ElevenLabs to synthesize the audio.
//   4. Writes recaps/<season>-wk<week>.mp3 and updates recaps/manifest.json, which is what the
//      site's homepage button and Nutcast Archive page read.
//
// Required environment variables (set as GitHub repo secrets -- see SETUP_RECAPS.md):
//   ANTHROPIC_API_KEY     Anthropic API key used to write the script.
//   ELEVENLABS_API_KEY    ElevenLabs API key used to synthesize the audio.
// Optional:
//   ANTHROPIC_MODEL       Defaults to a current Claude Sonnet model -- check
//                         https://docs.claude.com/en/docs/about-claude/models for the latest
//                         id and override here if you want a newer one.
//   ELEVENLABS_VOICE_ID   Defaults to an energetic ElevenLabs premade voice. Swap for any
//                         voice ID from your ElevenLabs Voice Library.
//   ELEVENLABS_MODEL_ID   Defaults to "eleven_turbo_v2_5".
//   RECAP_SEASON          Defaults to "2026".
//   RECAP_WEEK            Force a specific week (for backfill / manual runs). Auto-detected
//                         from Sleeper's current week otherwise.
//   RECAP_FORCE           "true" to regenerate + overwrite a week that already has an entry.
//   SITE_ENTRY            Path to the HTML file to serve, relative to the repo root.
//                         Defaults to "index.html".
// -----------------------------------------------------------------------------------------

import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const RECAPS_DIR = path.join(REPO_ROOT, "recaps");
const MANIFEST_PATH = path.join(RECAPS_DIR, "manifest.json");
const SITE_ENTRY = process.env.SITE_ENTRY || "index.html";

const SEASON = process.env.RECAP_SEASON || "2026";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // "Adam" -- energetic premade voice; swap freely
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
const FORCE = String(process.env.RECAP_FORCE || "").toLowerCase() === "true";

function log(...args) {
  console.log("[nutcast]", ...args);
}

// ---------- tiny static file server, so the page loads over http:// (relative fetches and
// the Firebase SDK's dynamic ES module imports both need a real origin, not file://) ----------
function serveRepoRoot() {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/" + SITE_ENTRY;
      const full = path.join(REPO_ROOT, p);
      const data = await fs.readFile(full);
      const ext = path.extname(full);
      const type =
        ext === ".html" ? "text/html" :
        ext === ".json" ? "application/json" :
        ext === ".js" ? "text/javascript" :
        ext === ".mjs" ? "text/javascript" :
        ext === ".css" ? "text/css" :
        "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

async function writeManifest(entries) {
  const sorted = entries.slice().sort((a, b) => (b.season - a.season) || (b.week - a.week));
  await fs.mkdir(RECAPS_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

// ---------- step 1: load the real site in a headless browser and pull structured facts ----------
async function getWeekFacts(page, week) {
  log("Waiting for the site's live data (Sleeper matchups, Power Rankings, FAAB, players)...");
  const readyDeadlineMs = Date.now() + 120000;
  let ready = false;
  while (Date.now() < readyDeadlineMs) {
    ready = await page.evaluate(() => (typeof isRecapDataReady === "function" ? isRecapDataReady() : false)).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(1500);
  }
  if (!ready) {
    throw new Error("Site data never became ready (isRecapDataReady() stayed false for 120s). Check that the deployed site loads Sleeper data without errors.");
  }
  log("Site data ready. Building week facts for week", week, "...");

  const facts = await page.evaluate((wk) => window.buildWeekRecapFacts(wk), week);
  return facts;
}

function weekLooksComplete(facts) {
  if (!facts || !Array.isArray(facts.matchups) || facts.matchups.length === 0) return false;
  return facts.matchups.every((m) => typeof m.teamA.score === "number" && typeof m.teamB.score === "number" && (m.teamA.score > 0 || m.teamB.score > 0));
}

// ---------- step 2: Claude writes the script ----------
const PERSONA = `You are "Duke 'The Nutcracker' Callahan," the longtime announcer of THE NUTCAST -- the weekly audio recap show
of a 12-team dynasty fantasy football league called "The NUT Fantasy Football League." Your delivery is big, warm, and a
little chaotic: think classic NFL-highlight-reel energy crossed with a Vegas oddsmaker. You love alliteration and
nicknames, you talk about point spreads and FAAB betting lines the way a sportsbook host talks about a line move, and you
treat the league's own mythology as real lore worth referencing when it fits: the league's championship trophy is called
"The Iron Throne," the last-place finisher plays in the "Toilet Bowl," Power Rankings are the league's own weekly
composite rating, and "the league bank" collects trade and waiver taxes. You never apologize for missing information --
if a category (upset, rivalry, betting, etc.) doesn't apply this week, you simply don't mention it, you don't say "there
was no X this week." You are enthusiastic but never cruel: needle a bad performance the way a good radio host ribs a
friend, not the way a bully mocks a stranger. Keep language clean (no profanity). You have a consistent signature
open and a consistent signature sign-off that should reappear, close to verbatim, episode after episode, the way a real
show's intro/outro music would -- but everything in between should be fresh, using the actual facts you're given.`;

function buildUserPrompt(facts, recentHistory, powerMovers) {
  return `Here are the real results and league data for Week ${facts.week} of the ${facts.season} season, as structured JSON. Use ONLY
the facts below -- never invent a score, a player, or an outcome that isn't in this data.

RECENT EPISODE HISTORY (for continuity -- callbacks, running jokes, tracking a manager's storyline across weeks; only
reference these if it's natural, don't force it):
${recentHistory.length ? JSON.stringify(recentHistory, null, 2) : "(no prior episodes yet -- this is the first Nutcast of the season, so introduce the show and the format)"}

POWER RANKING MOVEMENT SINCE LAST WEEK'S EPISODE:
${powerMovers ? JSON.stringify(powerMovers, null, 2) : "(no prior week to compare against)"}

THIS WEEK'S FACTS:
${JSON.stringify(facts, null, 2)}

Write a spoken-word radio script, roughly 700-1000 words (about 3-5 minutes read aloud at a natural pace), covering
whichever of these are actually interesting THIS week -- don't force every category, pick the best stories:
- the week's matchup results
- the closest game
- the biggest blowout
- the highest-scoring team
- the biggest upset against the pregame spread (only if biggestUpset is non-null)
- standout individual player performances (leagueTopPerformers)
- disappointing performances (leagueBustPerformers) -- only if there are real ones, don't manufacture disappointment
- FAAB betting results (faabResults) -- talk about it like a bookie discussing who beat the house
- the Game of the Week, if gameOfWeek is set
- any rivalry matchups (isRivalry true on a matchup), using rivalryRecordForA for head-to-head color
- notable standings or Power Ranking movement (standingsMovers / powerMovers)

Style rules:
- Spoken text only -- no stage directions, no markdown, no bullet points, no headers, nothing in brackets or asterisks.
  This goes straight into text-to-speech, so every word you write gets read aloud exactly as written.
- Use real team names, manager names, and player names exactly as given in the facts.
- Open with your signature intro and close with your signature sign-off.
- Vary sentence rhythm like a real broadcast -- short punchy lines mixed with longer ones.

Respond with ONLY a JSON object (no markdown code fence, no commentary) in exactly this shape:
{"title": "a punchy 6-10 word episode title", "synopsis": "one or two sentences teasing the episode, for the archive list", "script": "the full spoken script"}`;
}

async function generateScript(facts, recentHistory, powerMovers) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  log("Asking Claude to write the Week", facts.week, "script...");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: PERSONA,
      messages: [{ role: "user", content: buildUserPrompt(facts, recentHistory, powerMovers) }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const raw = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const jsonText = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error("Could not parse Claude's response as JSON. Raw response:\n" + raw.slice(0, 1000));
  }
  if (!parsed.script || !parsed.title) throw new Error("Claude's response was missing title/script fields.");
  return parsed;
}

// ---------- step 3: ElevenLabs turns the script into audio ----------
async function generateAudio(script) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set.");

  log("Sending script to ElevenLabs for text-to-speech...");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "audio/mpeg",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: script,
      model_id: ELEVENLABS_MODEL_ID,
      voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs API error ${res.status}: ${text.slice(0, 500)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

// ---------- main ----------
async function main() {
  const manifest = await readManifest();

  let { server, port } = await serveRepoRoot();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => log("page error:", e.message));
    await page.goto(`http://localhost:${port}/${SITE_ENTRY}`, { waitUntil: "load", timeout: 60000 });

    let week = process.env.RECAP_WEEK ? parseInt(process.env.RECAP_WEEK, 10) : null;
    if (!week) {
      const state = await page.evaluate(() => fetch("https://api.sleeper.app/v1/state/nfl").then((r) => r.json()));
      week = Math.max(1, (state.week || 1) - 1);
      log("Auto-detected target week:", week, "(current NFL week per Sleeper is", state.week, ")");
    }

    const existing = manifest.find((e) => String(e.season) === SEASON && Number(e.week) === week);
    if (existing && !FORCE) {
      log(`Week ${week} already has a Nutcast episode and RECAP_FORCE is not set -- nothing to do.`);
      return;
    }

    const facts = await getWeekFacts(page, week);
    if (!weekLooksComplete(facts)) {
      log(`Week ${week}'s matchups don't look final yet (some scores are still 0/missing) -- skipping this run. It will pick up next time the schedule fires, or re-run manually once the week is final.`);
      return;
    }

    const recentHistory = manifest
      .filter((e) => String(e.season) === SEASON && Number(e.week) < week)
      .sort((a, b) => b.week - a.week)
      .slice(0, 3)
      .map((e) => ({ week: e.week, title: e.title, synopsis: e.synopsis }));

    const lastEntry = manifest
      .filter((e) => String(e.season) === SEASON && Number(e.week) < week)
      .sort((a, b) => b.week - a.week)[0];
    let powerMovers = null;
    if (lastEntry && Array.isArray(lastEntry.powerRankOrder)) {
      const prevRank = {};
      lastEntry.powerRankOrder.forEach((rid, i) => { prevRank[rid] = i + 1; });
      powerMovers = facts.powerRankingsNow
        .map((p) => ({ team: p.team, rankBefore: prevRank[p.rosterId] || null, rankNow: p.rank }))
        .filter((p) => p.rankBefore !== null && p.rankBefore !== p.rankNow)
        .sort((a, b) => Math.abs(b.rankBefore - b.rankNow) - Math.abs(a.rankBefore - a.rankNow));
    }

    const { title, synopsis, script } = await generateScript(facts, recentHistory, powerMovers);
    log("Script ready:", title);

    const audioBuffer = await generateAudio(script);
    const audioFile = `${SEASON}-wk${week}.mp3`;
    await fs.mkdir(RECAPS_DIR, { recursive: true });
    await fs.writeFile(path.join(RECAPS_DIR, audioFile), audioBuffer);
    log("Audio written:", audioFile, `(${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    const entry = {
      season: SEASON,
      week,
      title,
      synopsis,
      script,
      audioFile,
      publishedAt: new Date().toISOString(),
      powerRankOrder: facts.powerRankingsNow.map((p) => p.rosterId),
    };
    const nextManifest = manifest.filter((e) => !(String(e.season) === SEASON && Number(e.week) === week));
    nextManifest.push(entry);
    await writeManifest(nextManifest);
    log(`Done. recaps/manifest.json updated for ${SEASON} Week ${week}.`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("[nutcast] FAILED:", err.message);
  process.exit(1);
});
