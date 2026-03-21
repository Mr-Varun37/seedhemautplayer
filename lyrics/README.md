# Synced Lyrics

Drop per-song `.lrc` files into this folder using the song slug from the app.

Examples:

- `lyrics/101.lrc`
- `lyrics/11k.lrc`
- `lyrics/namastute.lrc`

Format:

```text
[ar:Seedhe Maut]
[ti:Song Title]
[00:12.00] First synced line
[00:18.40] Second synced line
```

If a matching `.lrc` file is missing, the player falls back to static local notes in fan mode.
