#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

SDK_ROOT="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
TOOLS="$SDK_ROOT/build-tools/34.0.0"
PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
KEYSTORE="$HOME/.android/debug.keystore"
if test -n "${JAVA_HOME:-}"; then export PATH="$JAVA_HOME/bin:$PATH"; fi
# Build-tools 34 can't read classes from newer compilers: use JDK 17 (or 11–21).
java_major=$(javac -version 2>&1 | sed -E 's/^javac ([0-9]+).*/\1/')
case "$java_major" in 11|17|18|19|20|21) ;; *)
  echo "This build needs JDK 17 (found javac ${java_major:-none}). Set JAVA_HOME, for example:" >&2
  echo "  JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home $0   (macOS, Homebrew)" >&2
  echo "  JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 $0                                (Debian/Ubuntu)" >&2
  exit 1 ;;
esac
for tool in aapt2 d8 zipalign apksigner; do
  test -x "$TOOLS/$tool" || { echo "Missing $TOOLS/$tool" >&2; exit 1; }
done
test -f "$PLATFORM" || { echo "Missing $PLATFORM" >&2; exit 1; }

mkdir -p build
BUILD_DIR="$(mktemp -d build/tmp.XXXXXX)"
trap 'rm -rf "$BUILD_DIR"' EXIT
mkdir -p "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$BUILD_DIR/assets"
# Noor's Wi-Fi setup screen is shared with the Raspberry Pi kiosk (apps/kiosk-shared).
cp ../kiosk-shared/setup.html "$BUILD_DIR/assets/setup.html"
"$TOOLS/aapt2" link -o "$BUILD_DIR/base.apk" -I "$PLATFORM" \
  --manifest AndroidManifest.xml -A "$BUILD_DIR/assets" --min-sdk-version 23 --target-sdk-version 23 \
  --version-code 2 --version-name 0.2.0
javac -nowarn -source 8 -target 8 -classpath "$PLATFORM" \
  -d "$BUILD_DIR/classes" src/com/noor/frame/*.java
"$TOOLS/d8" --min-api 23 --lib "$PLATFORM" --output "$BUILD_DIR/dex" \
  "$BUILD_DIR/classes/com/noor/frame/"*.class
(cd "$BUILD_DIR/dex" && zip -q -j ../base.apk classes.dex)
"$TOOLS/zipalign" -f 4 "$BUILD_DIR/base.apk" "$BUILD_DIR/aligned.apk"

if test ! -f "$KEYSTORE"; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null
fi
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android \
  --key-pass pass:android --out build/noor-frame.apk "$BUILD_DIR/aligned.apk"
echo "Built apps/kiosk-android/build/noor-frame.apk"
