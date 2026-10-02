# Android TWA and iOS PWA

Brownbag uses the existing React/Vite frontend everywhere. Android is a small Trusted Web Activity (TWA) built directly with Google's Android Browser Helper. It opens `https://brownbag.polli.page/` in a compatible installed browser. There is no bundled Node runtime, webview UI fork, cloud build service, or required store account. Web changes ship with the website; rebuild the APK for native configuration or icon changes.

## Build an APK locally

Install **JDK 17**, Android SDK **platform 36** and **build-tools 35.0.0** using Android Studio or Google's command-line tools. Set `JAVA_HOME` and `ANDROID_HOME` (or put `sdk.dir=/absolute/sdk/path` in the ignored `android/local.properties`). Accept the SDK licenses using `sdkmanager --licenses`. Gradle 8.13 is downloaded and checksum-verified by the checked-in wrapper; no global Gradle install is needed.

```sh
npm run android:debug
# android/app/build/outputs/apk/debug/app-debug.apk

npm run android:unsigned
# android/app/build/outputs/apk/release/app-release-unsigned.apk
```

These builds do not need a running backend or web build. First builds need internet access for Gradle and Maven dependencies. The debug APK is automatically signed with the local Android debug key and is installable with `adb install -r PATH`. The release APK is deliberately unsigned and must be signed before installation. App ID: `page.polli.brownbag`. Increment `versionCode` in `android/app/build.gradle` for distributed updates.

## Signing and fullscreen verification

Use your own signing key for distribution, keeping it outside the repository and backed up securely. Reuse that key for updates. No purchased signing certificate is needed.

```sh
keytool -genkeypair -keystore /secure/location/brownbag.jks \
  -alias brownbag -keyalg RSA -keysize 2048 -validity 10000

# From Android SDK build-tools/35.0.0 (or add that directory to PATH):
zipalign -p -f 4 android/app/build/outputs/apk/release/app-release-unsigned.apk /tmp/brownbag-aligned.apk
apksigner sign --ks /secure/location/brownbag.jks --ks-key-alias brownbag \
  --out /tmp/brownbag.apk /tmp/brownbag-aligned.apk
apksigner verify --print-certs /tmp/brownbag.apk
keytool -list -v -keystore /secure/location/brownbag.jks -alias brownbag
```

Copy the colon-separated **SHA256** certificate fingerprint from `keytool`, then:

```sh
npm run android:assetlinks -- 'AA:BB:...all 32 bytes...'
npm run build
```

The example fingerprint is illustrative: the command validates complete fingerprints and rejects placeholders. It writes `public/.well-known/assetlinks.json`; deploying the web build publishes it. Multiple fingerprints can be passed if you intentionally support more than one signing certificate. With Play App Signing, use the app-signing certificate fingerprint, not the upload certificate.

The checked-in file starts as `[]`, deliberately trusting no certificate. Until the deployed file trusts the installed APK's certificate, Android falls back to a browser tab with controls. **The APK can build and run before fullscreen verification is configured.** Avoid trusting a debug certificate on the public domain for normal distribution.

Verify `https://brownbag.polli.page/.well-known/assetlinks.json` responds directly with HTTP 200 and JSON, without authentication or redirects. Both the Express server and Vercel routing expose the file. Never route this URL to the SPA or cache it in the service worker.

If changing domains, update the launcher URL/host in `AndroidManifest.xml`, the website relation in `res/values/strings.xml`, and the web deployment's `APP_ORIGIN`/OAuth configuration. If changing application ID, also update the assetlinks generator. External OAuth providers legitimately show browser controls; returning to the verified Brownbag origin should return to the app experience. Test real login and return navigation on an Android device.

## PWA behavior

- Manifest, regular/maskable icons, Apple touch icon, standalone display and safe-area handling.
- Installation guidance for iOS and the native browser installation prompt when available on Android.
- Static app-shell precaching with `vite-plugin-pwa`. APIs, OAuth, MCP, and domain-verification URLs remain network-only.
- **Keep recipe offline** stores public recipe text and attribution in IndexedDB. **Offline recipes** opens those copies, including after an offline restart. Photos are not downloaded. Copies are snapshots; remove/re-save to refresh them.
- Draft edits are backed up to local storage by account DID and editor route, with explicit restore/discard choices when returning to that editor while signed in. Backups are local recovery, not offline account authentication or cross-device synchronization. Save a private draft to sync to the server.
- Sign-out clears device recipes and recovery drafts. **Clear device data** also works without a connection. Browser storage can be cleared/evicted by the OS; it is not a durable backup.
- Updates wait for **Update now**, honoring the editor's leave guard. No forced reload while cooking or editing. Save work in other open Brownbag tabs before accepting an update.

Use **Share → Add to Home Screen** in Safari on iOS. First load requires a connection; private cookbook/meal-planner operations still require the server. No push notifications or background write queue are introduced.

Icons are checked in. Regenerate from the existing SVG mark using `npm run icons:generate`.

## Verification

```sh
npm test
npm run build
npm run format:check
npx tsx tests/support/preview.ts
```

The preview uses an isolated in-memory database and fake account. Open `http://127.0.0.1:3001`, keep a recipe offline, switch the browser offline, reload, and read it from Offline recipes. Reconnect, enter an unfinished recipe, reload, and restore the device backup. Confirm saving a private draft or signing out removes recovery data. Inspect Cache Storage: it should contain static shell assets only, never private API responses.

On real devices, verify iPhone Home Screen installation, keyboard and safe areas, offline restart, and Android signed APK installation, Digital Asset Links, OAuth return, and back navigation. Browser emulation cannot prove those platform behaviors.

References: [Android Browser Helper](https://github.com/GoogleChrome/android-browser-helper), [TWA overview](https://developer.chrome.com/docs/android/trusted-web-activity), [Android CLI builds](https://developer.android.com/build/building-cmdline), [Vite PWA](https://vite-pwa-org.netlify.app/).
