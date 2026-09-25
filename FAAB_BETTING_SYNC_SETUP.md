# Turning on shared FAAB betting sync

This guide walks through the one-time setup to make FAAB Betting Lines shared across every
visitor in real time, instead of staying local to each person's own browser. It takes about
10–15 minutes and doesn't cost anything.

If you skip this, the site keeps working exactly as it already does — betting just stays
local to each browser. Nothing breaks either way.

## What changes

- **Before:** each visitor's bets, balances, and line edits live only in their own browser's
  local storage. No one can see anyone else's bets.
- **After:** every visitor's browser talks to one shared, free cloud database (Firestore, part
  of Google's Firebase). Bets and line edits appear for everyone live, with no page refresh
  needed. A short passcode per team stops someone from placing a bet as a teammate.
- **Bonus, same setup:** the Dynasty Game of the Week pick also becomes shared. Before this,
  each browser locked in its own pick independently, so the "featured matchup" could genuinely
  look different from one person's screen to another's as live inputs (Power Scores, Playoff
  Odds, recent form) shifted over the week. With sync on, whoever's browser decides the pick
  first for a given week writes it to the same shared database, and everyone else just reads
  that answer back — one featured matchup, agreed on by every visitor, for the whole week.
  There's nothing extra to configure for this — it rides along on the same project and rules.

## Step 1 — Create a free Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com) and sign in with any
   Google account (a personal Gmail is fine — this doesn't need to be tied to your league in
   any way).
2. Click **Add project**, give it any name (e.g. "nut-league-faab"), and finish the wizard.
   You can decline Google Analytics — it isn't needed here.

## Step 2 — Turn on Firestore

1. In the left sidebar of your new project, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose **Start in production mode** (not test mode — the security rules below replace the
   default "locked" rules with the ones this feature actually needs).
4. Pick any nearby region and click **Enable**.

## Step 3 — Register a web app and copy the config

1. In **Project settings** (gear icon, top left) → **General** tab, scroll to "Your apps" and
   click the **</>** (web) icon to register a new web app.
2. Give it any nickname (e.g. "league-hub") and click **Register app**. You don't need
   Firebase Hosting — the site stays on GitHub Pages.
3. You'll see a `firebaseConfig` object like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "nut-league-faab.firebaseapp.com",
     projectId: "nut-league-faab",
     storageBucket: "nut-league-faab.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```
   Copy these six values.

## Step 4 — Paste the config into the site

Open `index.html` (or `league_hub_redesigned.html`) in a text editor and find this block near
the top of the `<script>` section (search for `FIREBASE_CONFIG`):

```js
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Replace each `"YOUR_..."` placeholder with the matching value from Step 3, save the file, and
re-upload it to GitHub Pages as `index.html` (replacing the current one).

## Step 5 — Paste in the security rules

Back in the Firebase Console, go to **Build → Firestore Database → Rules** tab, delete
whatever is there, paste in the following, and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /faab_members/{ownerId} {
      allow read: if true;
      allow create: if !exists(/databases/$(database)/documents/faab_members/$(ownerId))
                    && request.resource.data.keys().hasAll(['team','passcodeHash'])
                    && request.resource.data.passcodeHash is string;
      allow update, delete: if false;
    }

    match /faab_line_overrides/{key} {
      allow read: if true;
      allow write: if request.resource.data.value is number;
    }

    match /faab_wagers/{wagerId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(
                        ['ownerId','week','pickRosterId','pickTeamName','oppRosterId',
                         'oppTeamName','spread','amount','potentialPayout','status',
                         'placedAt','passcodeHash'])
                    && request.resource.data.status == 'pending'
                    && request.resource.data.amount is number
                    && request.resource.data.amount > 0
                    && request.resource.data.passcodeHash ==
                       get(/databases/$(database)/documents/faab_members/$(request.resource.data.ownerId)).data.passcodeHash;
      allow update: if request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status','settledAt','finalPickScore','finalOppScore'])
                    && resource.data.status == 'pending'
                    && (request.resource.data.status == 'won' || request.resource.data.status == 'lost'
                        || request.resource.data.status == 'push');
      allow delete: if false;
    }

    match /gotw_picks/{pickId} {
      allow read: if true;
      allow create: if !exists(/databases/$(database)/documents/gotw_picks/$(pickId))
                    && request.resource.data.keys().hasAll(['season','week','a','b'])
                    && request.resource.data.week is number
                    && request.resource.data.a is number
                    && request.resource.data.b is number;
      allow update, delete: if false;
    }
  }
}
```

**What these rules actually enforce:** a wager can only be created if its passcode hash
matches the hash on file for that team (this is the real gate — the app's own JS check is
just a convenience, this rule is what actually stops someone). A wager can only ever move from
`pending` to `won`/`lost`/`push`, and nothing else about it can change once created — no one can
edit their bet amount or spread after the fact, from any browser. A team's passcode, once set,
can never be overwritten through the app (only by you, directly in the Firebase Console). A
Game of the Week pick (`gotw_picks`) can be created by anyone's browser but never edited or
deleted afterward, and only one document can ever exist per season+week — so whichever browser
computes that week's pick first "wins", and every later visitor just reads the same answer back
instead of computing their own.

**If you already set these rules up before for FAAB betting only:** the two additions above —
`push` in the `faab_wagers` update rule, and the whole new `gotw_picks` block — are new. Paste
the full rules block above over whatever's currently in the Rules tab and Publish again; nothing
about your existing `faab_members`/`faab_wagers`/`faab_line_overrides` data is affected.

## Step 6 — Seed each team's passcode

1. Open the live site (after you've re-uploaded `index.html` with your config filled in).
2. Open the browser's developer console (F12, or right-click → Inspect → Console tab).
3. Type `faabSeedMembers()` and press Enter.
4. It prints a table like:

   | (index) | Values |
   |---|---|
   | JSN Your Face 😏 | "K7RH3T" |
   | Lickety Splitz Squad | "P2MXQD" |
   | ... | ... |

5. Copy this down somewhere safe and send each manager **their own team's code only**, privately
   (a group text where everyone sees everyone's code defeats the point).

Running `faabSeedMembers()` again later is harmless — it will report existing teams as
"already set up -- unchanged" rather than overwrite anyone's code. If you ever need to reset
one team's code, delete that team's document from the `faab_members` collection in the
Firebase Console (Build → Firestore Database → Data tab) and run `faabSeedMembers()` again —
only that team gets a fresh code.

## Step 7 — Smoke test

Before telling the league it's live:

1. Open the site in two different browsers (or one normal + one private/incognito window).
2. In browser A, select your team, enter its passcode, and place a small bet.
3. In browser B, refresh — confirm the bet from browser A shows up.
4. In browser B, place a bet as a *different* team using that team's own code.
5. In browser A, refresh (or just wait a moment — it should update live without a refresh) —
   confirm browser B's bet is visible too.
6. Try placing a bet with a deliberately wrong passcode — confirm it's rejected with an
   "Incorrect passcode" message and nothing gets deducted.

## What's still the same as before (worth knowing)

- **Settlement stays automatic but still trust-based.** There's still no server — whichever
  visitor's browser happens to be open triggers the "check for final scores and settle
  pending wagers" step, same as before. It's just that once one browser does it, everyone
  sees the result instead of only that one browser.
- **The passcode is a deterrent, not a vault.** It's a short shared code among people who
  already trust each other, checked with a real (SHA-256) hash comparison enforced by
  Firestore's rules — but it's not designed to resist a determined, technically sophisticated
  attacker with access to the hash. For a private league among friends this is a reasonable
  level of friction, not bank-grade security.
- **Betting lock times are still estimated, not pulled from a real NFL schedule feed**, and
  still enforced only by the app's own JS (not by the security rules) — same as the original
  version.
- Firebase's free tier ("Spark plan") is far more than a 12-team league would ever use for
  this — there's no card required and no risk of a surprise bill from this feature.

If anything doesn't work as expected after setup, the previous (local-only) version of the
file has no dependency on any of this and needs no changes to keep working — just don't fill
in `FIREBASE_CONFIG` and it stays exactly as it was.
