# PreFlop mobile apps (iOS and Android)

The native apps are a [Capacitor](https://capacitorjs.com) shell around the player web app (`apps/web`).

- **Same code everywhere.** The app ships the built web app inside it and loads it from the device. Only API calls (HTTPS and WebSocket) go over the network. Every screen, fix and feature of the web app is in the app after the next build.
- **Native behaviour** lives in `apps/web/src/lib/native.ts`, which loads only inside the app:
  - the app opens on the player app (`/app`), not the marketing home page;
  - the status bar is light text over the dark app, and the splash screen hides once the app has rendered;
  - Android Back closes an open sheet first, then goes back a screen, then sends the app to the background from a top-level screen;
  - returning to the app refreshes its data.
- **Layout.** It works on every phone and tablet size, from 320 px wide (iPhone SE) up, in portrait and landscape. The bars leave room for the notch, the status bar and the home indicator (`env(safe-area-inset-*)`).
- **Identity.** App id `com.preflop.app`; name **PreFlop**. The icons and splash screens are generated from `assets/` (`pnpm assets`).

## Get the Android app (no tools needed)
Every push to `main`, and every pull request that touches the apps, runs **Mobile apps** (`.github/workflows/mobile.yml`). It builds an installable debug APK.
1. GitHub → **Actions** → **Mobile apps** → the latest run → **Artifacts** → download `preflop-android-debug`.
2. Unzip it and copy `app-debug.apk` to the phone, or open the download on the phone.
3. Open it and allow "install from this source" when Android asks. This is a test build signed with a debug key; the Play Store needs a release build (below).

## Which API the app uses
The API address is built into the app. CI uses the repository variable `MOBILE_API_URL` (Settings → Secrets and variables → Actions → Variables); without it, CI uses staging, `https://preflop-staging-api.fly.dev`.

The API must allow the app's origins in `CORS_ORIGINS`: `capacitor://localhost` (iOS) and `https://localhost` (Android). Staging already does (`deploy/fly/api.toml`). Add both to production when it exists.

## Build locally
Requirements:
- Node 22 and pnpm;
- Android Studio (JDK 21, Android SDK 36) for Android;
- a Mac with Xcode 16+ for iOS.

```sh
pnpm install
cd apps/mobile
VITE_API_URL=https://preflop-staging-api.fly.dev VITE_WEB_URL=https://preflop-staging-web.vercel.app pnpm sync   # build the web app, copy it into both projects
pnpm android   # opens Android Studio → Run on a device or emulator
pnpm ios       # opens Xcode → pick your team under Signing & Capabilities → Run
```
Run `pnpm sync` again after every web change. `pnpm assets` regenerates the icons and splash screens from `assets/`.

## Publishing to the stores (owner steps)
| Store | What you need | Then |
|---|---|---|
| Google Play | A Google Play Console account (one-off fee) | Create an upload keystore. In Android Studio: Build → Generate Signed Bundle → Android App Bundle (`.aab`). Upload it to an internal-testing track first |
| App Store | An Apple Developer Program membership (yearly fee) and a Mac with Xcode | In Xcode set your Team, then Product → Archive → Distribute App → App Store Connect. Test with TestFlight first |

Both stores review apps that look like gambling closely.
- **Today.** PreFlop is free to play: chips and diamonds have no cash value and real money is off. Declare it as simulated gambling and use the matching age rating (17+ on the App Store, 18+ in the Play Console questionnaire).
- **Real money.** It needs the licences each store requires in every country where it is offered, so it is not enabled in the apps.
