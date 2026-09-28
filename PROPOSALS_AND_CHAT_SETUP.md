# Turning on the Proposals & Voting board and League Chat

Good news: this rides on the **same** Firebase project you already set up for FAAB Betting
Lines. There's no new project, no new config to paste in, and no new passcodes to hand out —
a team that can already place a bet can vote, post a proposal, and chat, using that exact same
passcode.

## What's new

- **Proposals & Voting** (under the League menu): any team can post a proposal — a rule
  change, trade veto, format tweak, anything — and every other team can vote Yes, No, or
  Abstain. Everyone sees every proposal and the live vote tally, in real time, no refresh
  needed.
- **League Chat** (under the League menu): a shared, permanent group chat for the whole league.

Both work exactly like FAAB betting from a setup standpoint: if you skip this, they keep
working, just local to each visitor's own browser (not shared). Turning on sync is one step.

## Step 1 — Update the security rules

This is the only step. Go to the [Firebase Console](https://console.firebase.google.com), open
your existing project (the same one from FAAB betting setup — likely named something like
"nut-league-faab"), then **Build → Firestore Database → Rules** tab.

Replace whatever's currently there with the block below (this is your **full** rules file —
it includes everything from before, plus the three new blocks at the end for `proposals`, its
`votes` subcollection, and `chat_messages`), then click **Publish**:

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

    match /proposals/{proposalId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(
                        ['ownerId','team','title','body','createdAt','status','passcodeHash'])
                    && request.resource.data.status == 'open'
                    && request.resource.data.title is string
                    && request.resource.data.title.size() > 0
                    && request.resource.data.title.size() <= 120
                    && request.resource.data.body is string
                    && request.resource.data.body.size() <= 2000
                    && request.resource.data.passcodeHash ==
                       get(/databases/$(database)/documents/faab_members/$(request.resource.data.ownerId)).data.passcodeHash;
      allow update, delete: if false;

      match /votes/{ownerId} {
        allow read: if true;
        allow create, update: if request.resource.data.keys().hasAll(['choice','team','votedAt','passcodeHash'])
                              && (request.resource.data.choice == 'yes'
                                  || request.resource.data.choice == 'no'
                                  || request.resource.data.choice == 'abstain')
                              && request.resource.data.passcodeHash ==
                                 get(/databases/$(database)/documents/faab_members/$(ownerId)).data.passcodeHash;
        allow delete: if false;
      }
    }

    match /chat_messages/{messageId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['ownerId','team','text','sentAt','passcodeHash'])
                    && request.resource.data.text is string
                    && request.resource.data.text.size() > 0
                    && request.resource.data.text.size() <= 500
                    && request.resource.data.passcodeHash ==
                       get(/databases/$(database)/documents/faab_members/$(request.resource.data.ownerId)).data.passcodeHash;
      allow update, delete: if false;
    }
  }
}
```

**If you haven't set up FAAB betting sync at all yet:** follow the original
`FAAB_BETTING_SYNC_SETUP.md` guide first (Steps 1–4 and 6 there — creating the project,
turning on Firestore, registering the web app, pasting `FIREBASE_CONFIG`, and seeding member
passcodes with `faabSeedMembers()`), then come back and paste the rules block above instead of
its original rules block. Nothing else changes.

That's it — no Step 2. The site's `index.html` already has everything it needs; you're only
updating the rules Firestore enforces.

## What these rules actually enforce

- **A proposal can only be created by a team whose passcode hash matches what's on file** in
  `faab_members` — same real gate as FAAB betting, enforced by Firestore itself, not just the
  page's own JS. Once posted, a proposal can never be edited or deleted through the app (if you
  ever need to remove one — a typo, a duplicate, spam — delete it directly in the Firebase
  Console's Data tab).
- **A vote is one document per team per proposal** (the document ID is the team's owner ID),
  so a team can only ever have one active vote per proposal — voting again overwrites their
  previous choice rather than adding a second vote. Only `yes`, `no`, or `abstain` are accepted,
  and only with that team's own passcode hash.
- **A chat message can only be sent by a team whose passcode hash matches**, same as above.
  Once sent, a message can't be edited or deleted through the app (delete a specific one
  directly in the Firebase Console's Data tab if you ever need to).
- Everyone — including someone who hasn't picked a team at all — can **read** every proposal,
  every vote tally, and every chat message. Only *posting/voting/chatting* requires the
  passcode.

## Identity carries over automatically

Because this reuses the exact same "who am I" team selection and the exact same cached
passcode as FAAB betting, a manager who's already unlocked their team for betting on a given
device won't be asked for their passcode again for voting or chatting on that same device —
it's remembered. A team that hasn't been seeded yet (i.e., `faabSeedMembers()` hasn't been run,
or that specific team wasn't in the list) will see a small note pointing back to you, the
commissioner, same as it does today on the betting page.

## Smoke test

Same idea as the FAAB betting smoke test:

1. Open the site in two browsers (or one normal + one private window).
2. In browser A, pick a team, post a test proposal, and vote on it.
3. In browser B, refresh — confirm the proposal and vote tally show up.
4. In browser B, vote as a *different* team — confirm browser A's tally updates live (no
   refresh needed).
5. Send a chat message from each browser — confirm both appear for both, live.
6. Try voting or posting with a deliberately wrong passcode — confirm it's rejected with an
   "Incorrect passcode" toast and nothing gets recorded.

## Worth knowing

- **The passcode is a deterrent, not a vault** — same as FAAB betting. It stops casual
  impersonation among people who already trust each other; it's not designed to resist a
  determined, technically sophisticated attacker.
- **Proposals and votes are permanent.** There's no "close" or archive step built into the page
  — a proposal just sits there with its live tally for as long as you want it visible. If you'd
  like a way to mark proposals as resolved/closed down the line, that's a small follow-up
  feature, not a rules change.
- **Chat has no moderation tools** (no delete, no edit, no reactions) — it's a simple, permanent
  shared log, on purpose, to keep the Firestore rules simple and hard to abuse. If the league
  wants richer chat later, that's also a reasonable follow-up.
