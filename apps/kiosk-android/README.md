# kiosk-android: Noor on an Android photo frame

**Noor Frame** is a tiny Android Home app: the dashboard in a fullscreen WebView.
It's built without Gradle, with one Java file and one HTML page. It was tested on
the AEEZO PF1007L (Allwinner A33, Android 6.0.1). It should suit other Android 6+
frames whose WebView is new enough, or can be made new enough.

If you are starting with a new frame, read the
[Android frame overview](../../docs/android-frame.md) first. Getting root ADB on
the PF1007L is covered in the [A33 frame guide](../../scripts/a33-frame/README.md).
This page starts from a frame with working root ADB.

| Property | Tested unit |
| --- | --- |
| SoC / board | Allwinner A33 / `astar_m86_8723cs` |
| Vendor / stock app | AEEZO, made by YHK / AiMOR `com.efercro.os.aimor` |
| Android / ABI | 6.0.1, API 23 / `armeabi-v7a` |
| RAM / display | 1 GB / 1280 × 800 IPS at 160 dpi |
| Stock WebView | 44.0.2403.119 (too old; see below) |
| USB after the ADB boot change | `1f3a:1002`, root ADB |

## What the app does

| Feature | How |
| --- | --- |
| Dashboard | Loads the Noor server's address in a fullscreen, immersive WebView, always horizontal. Sound may play without a tap. The screen stays on. |
| Home app | Declares the `HOME` category, so Android can boot straight into Noor. |
| Server address | Found on the network by itself (the server announces `_noor-frame._tcp`), chosen or typed on the Wi-Fi page, or set over USB with `SetServerActivity`. Other apps on the frame can't change it, and the app never shows pages from anywhere else. |
| Wi-Fi setup | `../kiosk-shared/setup.html` (shared with the Raspberry Pi kiosk): Noor's own Wi-Fi page with an on-screen keyboard. It opens from **Settings → Wi-Fi**, and by itself whenever the server can't be reached. Android's own screens never appear. |
| Recovery | When the dashboard fails to load, the Wi-Fi page shows why. It retries every 30 seconds once nobody is touching the screen, so the frame recovers by itself after a power cut. |
| Volume | **Settings → Sound** sets Android's media volume, because the frame has no volume buttons. |

The dashboard talks to the app through `window.Frame`. See `src/MainActivity.java`
and `apps/frame/src/device.js`.

| `window.Frame` call | Does |
| --- | --- |
| `openWifiSettings()` | Shows Noor's Wi-Fi page. |
| `openDashboard()` | Loads the saved server address. |
| `serverUrl()` / `setServerUrl(url)` | Reads or changes the saved address. |
| `status()` / `scan()` / `networks()` / `connect(ssid, password, security)` | Wi-Fi state, scanning and joining. These are used by the Wi-Fi page. |
| `volume()` / `setVolume(level)` | Media volume as `{"level", "max"}`. Changing it never shows Android's volume panel. |

Wi-Fi limits: WPA/WPA2 personal and open networks work. WEP and enterprise
(EAP) networks are listed as not supported.

## Build

You need the Android command-line tools with build-tools 34.0.0 and platform
android-34, plus JDK 17 (11–21 work; newer ones make build-tools 34 crash, so
the script stops and says so). The script signs the APK with your debug key and
creates one if needed. The SDK usually lives in `~/Library/Android/sdk` on macOS
and `~/Android/Sdk` on Linux.

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"         # your SDK root
export JAVA_HOME=/path/to/jdk-17   # macOS + Homebrew: /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ADB="$ANDROID_HOME/platform-tools/adb"
bash apps/kiosk-android/build.sh                         # → apps/kiosk-android/build/noor-frame.apk
```

## Install and try it over USB

Start the server on your computer (`npm run build && npm start` in the repo
root). Then:

```sh
"$ADB" devices -l
"$ADB" install -r apps/kiosk-android/build/noor-frame.apk
# Android 6 only lists nearby Wi-Fi networks to apps with location access.
# Granting it now means Android's permission dialog never appears.
"$ADB" shell pm grant com.noor.frame android.permission.ACCESS_COARSE_LOCATION
"$ADB" reverse tcp:8787 tcp:8787
"$ADB" shell 'am start -a android.intent.action.VIEW -d "http://127.0.0.1:8787/" -n com.noor.frame/.SetServerActivity'
"$ADB" logcat -d | grep NoorFrame | tail -30
```

`127.0.0.1` reaches your computer only through `adb reverse`, which stops
working when USB is unplugged or ADB restarts. For daily use the frame finds the
server on your Wi-Fi by itself (see [Make Noor the Home app](#make-noor-the-home-app)).

`SetServerActivity` is the only way to set the address from outside the frame,
and only ADB can open it: it requires `WRITE_SECURE_SETTINGS`, which the ADB
shell has and ordinary apps can't get. The main screen ignores addresses sent
to it by other apps.

If the screen stays blank, the WebView is too old. That's the next section.

## Replace the system WebView (Android 6 frames)

The dashboard is built for Chrome 106 or newer. Stock WebView 44 loads a plain
page but can't run the dashboard's `type="module"` script, so the screen stays
blank. The new WebView can't be installed as an update either:
`adb install` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` because it's
signed with a different key. The working route replaces the WebView files in
`/system` and keeps the originals beside them for rollback.

This changes `/system`. Have a verified full backup first, and do every check.
The route follows the [upstream PF1007L guide](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/allwinner-a33-pf1007l.md#6-upgrade-webview-before-using-the-kiosk).

### 1. Download and check the WebView

The APK is a LineageOS prebuilt WebView 106.0.5249.126 (minimum SDK 23), pinned
to one commit:

```sh
mkdir -p diagnostics/webview-stage/lib/arm
curl -L -o diagnostics/webview-106.apk \
  https://raw.githubusercontent.com/LineageOS/android_external_chromium-webview_prebuilt_arm/4b0ae494a7dd/webview.apk
shasum -a 256 diagnostics/webview-106.apk
```

The hash must be
`e2edc1f89ec1608b169da9e7ffc037190b70c7825f0be29694f4cae719980580`.

Android 6 doesn't unpack this system app's native libraries. If only the APK is
replaced, Android reports version 106 but WebView fails to start. Extract the
libraries on your computer:

```sh
unzip -j diagnostics/webview-106.apk 'lib/armeabi-v7a/*.so' -d diagnostics/webview-stage/lib/arm
cp diagnostics/webview-106.apk diagnostics/webview-stage/webview.apk
shasum -a 256 diagnostics/webview-stage/webview.apk diagnostics/webview-stage/lib/arm/*.so
```

The tested files were:

| File | SHA-256 |
| --- | --- |
| `webview.apk` | `e2edc1f89ec1608b169da9e7ffc037190b70c7825f0be29694f4cae719980580` |
| `lib/arm/libchromium_android_linker.so` | `94211d3b11689179f57993f9749142c9a0b77bb0677f0115ac0573b23defff82` |
| `lib/arm/libcrashpad_handler_trampoline.so` | `39293822e62a7036df00e051084142df992d2e33959d565534eaf8338b576b55` |
| `lib/arm/libwebviewchromium.so` | `251037128d1125b1ad7a9f8286f5258814dc403cfe5106be3ca05e254260d49f` |

### 2. Back up the stock WebView and stage the new one

Read the stock WebView tree twice and check that both copies match:

```sh
mkdir -p backups
"$ADB" exec-out 'tar -cf - -C /system/app webview' > backups/a33-stock-webview.tar
"$ADB" exec-out 'tar -cf - -C /system/app webview' | shasum -a 256
shasum -a 256 backups/a33-stock-webview.tar          # must equal the line above
tar -tf backups/a33-stock-webview.tar                # webview.apk and oat/arm/webview.odex
```

Then copy the new files to the frame's temporary folder:

```sh
"$ADB" shell 'mkdir -p /data/local/tmp/noor-webview/lib/arm'
"$ADB" push diagnostics/webview-stage/webview.apk /data/local/tmp/noor-webview/
"$ADB" push diagnostics/webview-stage/lib/arm/. /data/local/tmp/noor-webview/lib/arm/
for name in webview.apk lib/arm/libchromium_android_linker.so lib/arm/libcrashpad_handler_trampoline.so lib/arm/libwebviewchromium.so; do
  "$ADB" exec-out "cat /data/local/tmp/noor-webview/$name" | shasum -a 256
done
```

The four hashes must match the table above.

### 3. Preflight

```sh
"$ADB" shell id                                   # uid=0(root)
"$ADB" shell 'mount | grep " /system "'           # ro
"$ADB" shell 'toybox df -k /system'               # the tested unit had 408,560 KiB free; ~300,000 is enough
"$ADB" shell 'test ! -e /system/noor-stock-webview && test ! -e /system/noor-new-webview && test ! -e /system/noor-failed-webview && echo clear'
```

Stop if any rollback or staging folder already exists. Don't overwrite it.

### 4. Build the new tree and check every byte

```sh
"$ADB" shell 'mount -o remount,rw /system && mkdir /system/noor-new-webview && mkdir -p /system/noor-new-webview/lib/arm'
"$ADB" shell 'cp /data/local/tmp/noor-webview/webview.apk /system/noor-new-webview/webview.apk && cp /data/local/tmp/noor-webview/lib/arm/*.so /system/noor-new-webview/lib/arm/'
"$ADB" shell 'chown -R 0:0 /system/noor-new-webview && chmod 0755 /system/noor-new-webview /system/noor-new-webview/lib /system/noor-new-webview/lib/arm && chmod 0644 /system/noor-new-webview/webview.apk /system/noor-new-webview/lib/arm/*.so'
"$ADB" shell 'ls -lR /system/noor-new-webview'
for name in webview.apk lib/arm/libchromium_android_linker.so lib/arm/libcrashpad_handler_trampoline.so lib/arm/libwebviewchromium.so; do
  "$ADB" exec-out "cat /system/noor-new-webview/$name" | shasum -a 256
done
```

If any hash differs, run `"$ADB" shell 'mount -o remount,ro /system'` and stop.

### 5. Swap, then reboot

```sh
"$ADB" shell 'mv /system/app/webview /system/noor-stock-webview && mv /system/noor-new-webview /system/app/webview'
"$ADB" shell 'ls -lR /system/app/webview; ls -lR /system/noor-stock-webview'
"$ADB" shell 'sync && mount -o remount,ro /system && mount | grep " /system "'
"$ADB" reboot
```

The stock APK and `oat/arm/webview.odex` must still be in
`/system/noor-stock-webview`. After the reboot:

```sh
"$ADB" shell getprop sys.boot_completed            # 1
"$ADB" shell 'dumpsys package com.android.webview | grep -E "versionName|codePath"'   # 106.0.5249.126, /system/app/webview
"$ADB" logcat -d | grep -iE 'dlopen failed|Failed to load library'                     # nothing
```

Then launch Noor as in [Install and try it](#install-and-try-it-over-usb) and
check that the whole dashboard renders, both after the first launch and after
`am force-stop com.noor.frame` and a relaunch. Chromium may log
`eglChooseConfig failed with error EGL_BAD_ATTRIBUTE`. That's harmless.

### Roll back

If anything fails after the swap and both trees are present:

```sh
"$ADB" shell 'mount -o remount,rw /system'
"$ADB" shell 'mv /system/app/webview /system/noor-failed-webview && mv /system/noor-stock-webview /system/app/webview'
"$ADB" shell 'sync && mount -o remount,ro /system'
```

Before rebooting, compare `/system/app/webview/webview.apk` and
`oat/arm/webview.odex` with `backups/a33-stock-webview.tar`. Don't delete either
tree. If the state is partial or unexpected, rebuild the tree from the tar
rather than guessing at moves.

## Make Noor the Home app

Do this only once the dashboard renders. Before you start, point the frame at a
server it can reach without USB, such as a Raspberry Pi or another always-on
computer on your Wi-Fi.

1. **Join Wi-Fi.** On the frame, open **Settings → Wi-Fi** in Noor and choose
   your network. If the stock vendor app is still enabled, read
   [Disable the vendor apps](#disable-the-vendor-apps) first: on the tested
   firmware it shouldn't go online.
2. **Find the server.** Once the frame is on Wi-Fi, it looks for Noor servers
   announcing themselves on the network. Every server does this (`dns-sd` on a
   Mac, `avahi-publish` on Linux, Avahi on a Raspberry Pi set up with
   `apps/kiosk-pi/install.sh`; `NOOR_ANNOUNCE=0` turns it off):
   - **One server:** the frame uses it and opens the dashboard.
   - **More than one:** the Wi-Fi page lists them under **Noor servers on this
     network**. Tap yours.
   - **None found** (a server on another network, or a computer without
     `dns-sd`/`avahi-publish`): tap **Change** under **Noor server** and type
     its address, or set it over ADB:
     ```sh
     "$ADB" reverse --remove-all
     "$ADB" shell 'am start -a android.intent.action.VIEW -d "http://<server-address>:8787/" -n com.noor.frame/.SetServerActivity'
     ```
   If the server later moves to a new address, the frame finds it again the
   same way when the old address stops answering.
3. **Choose Noor as Home.** Press Home and choose **Noor Frame → Always**:
   ```sh
   "$ADB" shell input keyevent KEYCODE_HOME
   "$ADB" shell 'dumpsys activity activities | grep mResumedActivity'
   ```
   Android 6 has no command for setting the default Home app, so this choice is
   made on the screen.
4. **Reboot and check.** `"$ADB" reboot` should come back to Noor.

## Disable the vendor apps

On the tested firmware, the stock frame app **AiMOR** has a reported
[unencrypted remote command channel](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/aimor-remote-root-shell.md)
that can run shell commands as root. Keep the frame off your Wi-Fi until
AiMOR is disabled.

Only disable once Noor is Home and has survived a reboot. Disable one package
at a time and check that Noor is still showing after each:

```sh
"$ADB" shell pm disable-user --user 0 com.efercro.os.aimor   # stock frame app
"$ADB" shell pm disable-user --user 0 com.yhk.qeota          # vendor OTA updater
"$ADB" shell pm disable-user --user 0 com.DeviceTest         # factory test app
"$ADB" shell pm list packages -d
"$ADB" reboot
```

- **Leave everything else enabled.** Don't blanket-disable Android services,
  Settings, Package Installer or WebView.
- **`com.android.gl2jni`** (in `/system/priv-app/tomas/` on the tested
  firmware) is an old debuggable OpenGL demo app. It's safe to disable too,
  or to leave alone.
- **Undo:** disabling is reversible with `"$ADB" shell pm enable <package>`.
  It doesn't free `/system` space.
- **No factory reset:** neither deleting vendor APKs nor a factory reset is
  needed. A factory reset would also erase Noor and its saved address.

## Always horizontal

The Noor app is locked to landscape (`android:screenOrientation="landscape"`). Turn off
Android's auto-rotate as well, so Android's own screens can't turn vertical either:

```sh
"$ADB" shell 'settings put system accelerometer_rotation 0; settings put system user_rotation 0'
```

## Brightness

Settings are reached over ADB. For full brightness with auto-brightness off:

```sh
"$ADB" shell 'settings put system screen_brightness_mode 0; settings put system screen_brightness 255'
```

## Boot animation

`bootanimation/animation.html` is Noor's startup animation. نور (*noor*) means light:
1. A point of light blooms in the dark.
2. Rays and a wave of light turn the screen green.
3. The word is written right to left by the light.
4. NOOR FRAME appears beneath it.

Then the light breathes and a shine crosses the word until Android has started.
Open the HTML file in a browser to watch it.

Build it into Android's `bootanimation.zip`: 1280 × 800, 20 fps, a 3-second
intro and a 4-second loop, with JPEG frames, about 18 MB. This needs Playwright's
Chromium and, once, the internet for the fonts.

```sh
node apps/kiosk-android/bootanimation/render.mjs            # → apps/kiosk-android/build/bootanimation.zip
node apps/kiosk-android/bootanimation/render.mjs --preview  # a few stills, to check a change
```

**Try it without changing `/system`.** Mount it over the stock file, play it,
then unmount it:

```sh
"$ADB" push apps/kiosk-android/build/bootanimation.zip /data/local/tmp/noor-bootanimation.zip
"$ADB" shell 'mount -o bind /data/local/tmp/noor-bootanimation.zip /system/media/bootanimation.zip && setprop service.bootanim.exit 0 && start bootanim'
"$ADB" shell 'setprop service.bootanim.exit 1; stop bootanim; umount /system/media/bootanimation.zip'
```

**Install it.** Keep the stock file beside it, and a copy on your computer:

```sh
"$ADB" pull /system/media/bootanimation.zip backups/stock-bootanimation.zip
"$ADB" shell 'test ! -e /system/media/noor-stock-bootanimation.zip && mount -o remount,rw /system && cp /system/media/bootanimation.zip /system/media/noor-stock-bootanimation.zip && cp /data/local/tmp/noor-bootanimation.zip /system/media/bootanimation.zip && chmod 0644 /system/media/bootanimation.zip && sync && mount -o remount,ro /system'
```

Check with `shasum -a 256` on both sides, then reboot.

**Undo it:**

```sh
"$ADB" shell 'mount -o remount,rw /system && cp /system/media/noor-stock-bootanimation.zip /system/media/bootanimation.zip && sync && mount -o remount,ro /system'
```

A broken boot animation can't stop Android starting; the screen is just black
until Home appears.

### Boot logos

Before the animation, the frame shows a still picture twice: once from the
bootloader, then once as Android starts. On the stock frame it's the vendor's
logo. Both are the panel's native portrait 800 × 1280, so the landscape picture
is turned a quarter turn:

| File | Format |
| --- | --- |
| `bootlogo.bmp` on the `bootloader` partition (FAT, mounted at `/bootloader`) | BMP3, 24-bit, 3,072,054 bytes |
| `/system/media/initlogo.rle` | raw BGRA despite the name, 4,096,000 bytes |

Make both from the animation's last frame (needs ImageMagick):

```sh
B=apps/kiosk-android/build
node apps/kiosk-android/bootanimation/render.mjs --still $B/noor-still.png
magick $B/noor-still.png -rotate 90 -type TrueColor BMP3:$B/noor-bootlogo.bmp
magick $B/noor-still.png -rotate 90 -depth 8 bgra:$B/noor-initlogo.rle
```

**Install them.** Wait until `getprop sys.boot_completed` says `1`: Android
restarts USB while it starts, which drops `adb shell` mid-copy. Keep the stock
files in `/system/media`, write each new one under a temporary name, compare
its hash, and only then rename it into place. A dropped connection then can't
leave half a logo:

```sh
"$ADB" pull /bootloader/bootlogo.bmp backups/stock-bootlogo.bmp
"$ADB" pull /system/media/initlogo.rle backups/stock-initlogo.rle
"$ADB" push $B/noor-bootlogo.bmp $B/noor-initlogo.rle /data/local/tmp/
"$ADB" shell 'mount -o remount,rw /system && cd /system/media &&
  cat initlogo.rle > noor-stock-initlogo.rle && cat /bootloader/bootlogo.bmp > noor-stock-bootlogo.bmp &&
  cat /data/local/tmp/noor-initlogo.rle > initlogo.rle.new && cat /data/local/tmp/noor-bootlogo.bmp > /bootloader/bootlogo.new &&
  sync && md5sum noor-stock-* initlogo.rle.new /bootloader/bootlogo.new'
md5 -r backups/stock-*logo* $B/noor-*logo*     # Linux: md5sum. Every pair must match.
"$ADB" shell 'mv /system/media/initlogo.rle.new /system/media/initlogo.rle && chmod 0644 /system/media/initlogo.rle &&
  mv /bootloader/bootlogo.new /bootloader/bootlogo.bmp && sync && mount -o remount,ro /system'
```

**Undo it:**

```sh
"$ADB" shell 'mount -o remount,rw /system && cd /system/media &&
  cat noor-stock-initlogo.rle > initlogo.rle && cat noor-stock-bootlogo.bmp > /bootloader/bootlogo.bmp &&
  sync && mount -o remount,ro /system'
```

Leave the other files on the `bootloader` partition alone (`magic.bin`, the
battery pictures, fonts and ID files). A missing or broken logo only leaves the
screen black for a few seconds; Android still starts.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Blank screen in the kiosk | WebView is too old: `dumpsys package com.android.webview | grep versionName`. |
| Slow first minute after a reboot | On a 1 GB frame, Android's low-memory killer can restart Noor a few times while the system starts. Give it two minutes before calling it stuck. |
| The frame doesn't find the server | The computer must be on the same Wi-Fi, running `npm start`, with `dns-sd` (macOS, Windows with Bonjour) or `avahi-publish` (Linux). Guest networks and some mesh routers block these announcements; type the address instead. |
| Version 106 but WebView crashes | The native libraries are missing from `/system/app/webview/lib/arm`. Look for `dlopen failed` in logcat. |
| "Noor can't reach its server" | The server is off, or its address changed. Tap **Change** under **Noor server**. The page retries by itself every 30 s. |
| No networks listed | The location permission is missing: `pm grant com.noor.frame android.permission.ACCESS_COARSE_LOCATION`. |
| "Wrong password" | Retype it. Use **Show** to check. |
| Ayah recitation won't play | Older Android can't verify newer https certificates. The server relays the recitation through `/api/ayah/audio`, so update the server. |
| Stuck on an Android screen | The frame has no Back or Home button: `"$ADB" shell am start -n com.noor.frame/.MainActivity`. |
| Home goes to the vendor app | `"$ADB" shell pm enable com.efercro.os.aimor`, then choose Noor again in the Home chooser. |

Logs: `"$ADB" logcat -d | grep NoorFrame`. The app logs page errors, Wi-Fi joins
and volume changes there, and forwards the dashboard's console messages.
