#!/usr/bin/env bash
# Turns an audio or video file into the dashboard's athan: trims the silence at the start,
# normalises loudness, and saves it as an MP3 in public/audio/.
#
#   scripts/prepare-athan.sh fajr    ~/Downloads/my-fajr-athan.m4a
#   scripts/prepare-athan.sh regular ~/Downloads/my-athan.mp3
#
# Needs ffmpeg (brew install ffmpeg). Any format ffmpeg reads works (mp3, m4a, wav, mp4, webm…).
set -euo pipefail
cd "$(dirname "$0")/.."

kind="${1:-}"; src="${2:-}"
case "$kind" in
  fajr) out="public/audio/athan-fajr.mp3" ;;
  regular) out="public/audio/athan.mp3" ;;
  *) echo "Usage: $0 fajr|regular <file>"; exit 1 ;;
esac
[ -f "$src" ] || { echo "File not found: $src"; exit 1; }
mkdir -p public/audio

before=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
# silenceremove: drop everything quieter than -45 dB at the start (keeps 0.15 s so the first
# word isn't clipped). loudnorm: even volume between the two recordings.
ffmpeg -hide_banner -loglevel error -y -i "$src" -vn \
  -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ac 2 -ar 44100 -codec:a libmp3lame -q:a 2 "$out"
after=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")

printf 'Saved %s\n  before: %.1f s\n  after:  %.1f s (trimmed %.1f s of silence from the start)\n' "$out" "$before" "$after" "$(echo "$before - $after" | bc)"
