# Native mobile builds

Brownbag is an Expo React Native app. Android renders native views and stores local content in SQLite. The APK bundles app code and fonts; it does not wrap the hosted website.

## Local APK

Install Node 24, JDK 17, and the Android SDK required by Expo 58. Configure `ANDROID_HOME` and accept the SDK licenses.

```sh
npm ci
npm run build:apk
```

The result is `android/app/build/outputs/apk/release/app-release.apk`. Expo generates `android/`, which Git ignores. CI runs the same command and uploads the APK under workflow artifacts. The generated template signs with its debug key for sideload testing. Use a stable release keystore for distribution. An old TWA signed with another key must be backed up and uninstalled before installing this APK with the same package ID.

The package ID is `page.polli.brownbag`. Register `brownbag://callback` against Polli's WorkOS client. The public client ID and API origins must exist before building. CI uses repository variables `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WORKOS_CLIENT_ID`. Without a client ID, the APK works in local mode.

`localhost` on a phone means the phone. For local API development, use a reachable HTTPS endpoint or development tunnel. Production APKs should use the deployed HTTPS API.

## EAS alternative

After linking the app to your Expo project:

```sh
npx eas-cli build --platform android --profile preview
```

`eas.json` defines an APK preview profile and an App Bundle production profile. EAS manages signing and may require an Expo account. Local builds and CI do not need EAS.

The same code exports to iOS and web. iOS compilation requires macOS/Xcode or EAS plus Apple signing. Native refresh credentials use SecureStore, separate from the SQLite cache.
