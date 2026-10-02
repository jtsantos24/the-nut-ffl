# The NUT FFL native app

Capacitor packages the league website into an iOS and Android app. It uses the
same Sleeper and Firestore data as the live site; wagers submitted in a device
build are real league wagers.

## Build

From `mobile/`:

```sh
npm ci
npm run sync
npm run open:ios       # on a Mac with Xcode
npm run open:android   # with Android Studio
```

The `build:web` script copies the current root website and its assets into
`mobile/www`; `cap sync` then updates both native projects. Repeat `npm run
sync` after changing the website. The generated `www` directory is ignored by
Git because the website remains the source of truth.

The native app runs bundled HTML, so it can open its interface without a
network connection. Live league scores, Nutcast updates, and the shared FAAB
ledger require connectivity. The web service worker is disabled inside the
native container to avoid a second stale cache.

## Before distribution

- Test iOS and Android devices, including Sleeper loading, Nutcast playback,
  external links, Back behavior, and Firestore read/write permissions.
- Replace/check native app icons and launch screens in the platform projects.
- Configure signing with the owner's Apple Developer and Google Play accounts.
- Review store policies and release metadata before submission.

The package identifier is `com.thenutfriends.ffl`; confirm that it is available
in both store accounts before the first published build. Push notifications are
not implemented.
