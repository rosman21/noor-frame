# Athan recordings

The frame plays two files from this folder:

- `athan.mp3`: the athan for Dhuhr, Asr, Maghrib and Isha
- `athan-fajr.mp3`: the Fajr athan

Recordings aren't included, because most are copyrighted. Use recordings you have the right to use, then trim the silence and even out the volume with:

```sh
apps/frame/scripts/prepare-athan.sh regular ~/Downloads/my-athan.mp3
apps/frame/scripts/prepare-athan.sh fajr ~/Downloads/my-fajr-athan.mp3
```

This needs `ffmpeg` (`brew install ffmpeg` or `sudo apt install ffmpeg`). Without these files, the frame plays a short built-in chime instead.
