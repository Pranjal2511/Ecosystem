# Build on Android

## Environment gap

The development machine that created this repository **did not have a JDK**. `java` was missing from PATH and `JAVA_HOME` was empty. An Android SDK folder existed at `%LOCALAPPDATA%\Android\Sdk`, but no APK could be compiled here.

Until JDK 17 and a complete Android SDK are installed, treat Android as **source-complete, build-unverified**.

## Install

1. Android Studio (latest stable).
2. SDK Platform 35, Build-Tools 35, NDK if the template requests it.
3. JDK 17 (Temurin or Android Studio JBR).
4. Set `JAVA_HOME` and `ANDROID_HOME`.

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17*"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

## Commands (after JDK is available)

```powershell
cd D:\nexashare
npm install
cd apps\android
npx react-native start
```

In a second terminal:

```powershell
cd D:\nexashare\apps\android
npx react-native run-android
```

Debug APK (Gradle, after wrapper is present):

```powershell
cd D:\nexashare\apps\android\android
.\gradlew.bat assembleDebug
```

Install on a Realme phone: enable USB debugging, accept the RSA prompt, then `adb install -r app\build\outputs\apk\debug\app-debug.apk`.

## Signing

Generate a release keystore **outside the repo**. Never commit `.jks` / `.keystore` except the public Android debug keystore if you add one locally.

## Realme / physical devices

No Realme hardware was attached during this implementation. Do not claim Realme-specific compatibility. Test:

- Background restrictions / battery optimization
- Hotspot as AP vs client
- SAF document picker URIs
- Foreground service persistence

Files larger than 32 MB are now streamed using chunked `RequestBody` (bounded memory). The pairing fingerprint uses the real TLS identity (`DeviceIdentityFactory`). Incoming approval (`decide`) and bounded-memory receiving (`TlsProtocolServer`) are implemented in Kotlin source but require a physical device for full verification.
