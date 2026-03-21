function parseTimestamp(value) {
    const match = value.match(/(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?/);
    if (!match) {
        return null;
    }

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0")}`) : 0;
    return (minutes * 60) + seconds + fraction;
}

export function parseLrc(source) {
    const lines = String(source || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const timedLines = [];
    const metadata = {};

    lines.forEach((line) => {
        const metadataMatch = line.match(/^\[([a-z]+):([^\]]+)\]$/i);
        if (metadataMatch && Number.isNaN(Number(metadataMatch[1]))) {
            metadata[metadataMatch[1].toLowerCase()] = metadataMatch[2].trim();
            return;
        }

        const matches = [...line.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
        if (!matches.length) {
            return;
        }

        const text = line.replace(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g, "").trim();
        matches.forEach((match) => {
            const time = parseTimestamp(match[1]);
            if (time !== null) {
                timedLines.push({ time, text: text || "..." });
            }
        });
    });

    timedLines.sort((a, b) => a.time - b.time);

    return {
        mode: timedLines.length ? "synced" : "static",
        metadata,
        lines: timedLines
    };
}

export async function loadLyricsForSong(song) {
    const staticLines = Array.isArray(song?.lyrics?.lines) ? song.lyrics.lines : [];
    const fallback = {
        mode: "static",
        lines: staticLines.map((line) => typeof line === "string" ? { text: line } : line).filter((line) => line?.text)
    };

    if (!song?.lyricsAsset) {
        return fallback;
    }

    try {
        const response = await fetch(song.lyricsAsset, { cache: "force-cache" });
        if (!response.ok) {
            return fallback;
        }

        const parsed = parseLrc(await response.text());
        return parsed.lines.length ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

export function getActiveLyricIndex(lyrics, currentTime) {
    if (!lyrics || lyrics.mode !== "synced" || !lyrics.lines.length) {
        return -1;
    }

    let activeIndex = -1;
    for (let index = 0; index < lyrics.lines.length; index += 1) {
        if (currentTime >= lyrics.lines[index].time) {
            activeIndex = index;
        } else {
            break;
        }
    }
    return activeIndex;
}
