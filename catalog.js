import { groupBy, slugify } from "./utils.js";

const ALBUM_META = {
    "Lunch Break": { year: 2023, theme: "lunchbreak", description: "High-voltage chaos, flex, and tour energy." },
    "Nayaab": { year: 2022, theme: "nayaab", description: "Dark textures, pressure, and introspection." },
    "Bayaan & Early Cuts": { year: 2018, theme: "bayaan", description: "Raw foundations and early fan staples." },
    "Singles & Collabs": { year: 2024, theme: "dynamic", description: "Loose singles, features, and collabs." }
};

const SONG_META = {
    "101": { album: "Bayaan & Early Cuts", year: 2018, moods: ["hype", "dark"] },
    "11K": { album: "Lunch Break", year: 2023, moods: ["dark", "late-night"] },
    "Akatsuki": { album: "Singles & Collabs", year: 2024, moods: ["dark", "hype"] },
    "Anaadi": { album: "Nayaab", year: 2022, moods: ["late-night", "dark"] },
    "Asal G": { album: "Nayaab", year: 2022, moods: ["hype", "dark"] },
    "Bajenge": { album: "Bayaan & Early Cuts", year: 2018, moods: ["hype"] },
    "Batti": { album: "Singles & Collabs", year: 2024, moods: ["hype", "late-night"] },
    "Bhussi": { album: "Lunch Break", year: 2023, moods: ["hype", "dark"] },
    "Bure Din": { album: "Nayaab", year: 2022, moods: ["dark", "late-night"] },
    "Caramel Tax": { album: "Singles & Collabs", year: 2024, moods: ["chill", "late-night"] },
    "Chalo Chalein": { album: "Nayaab", year: 2022, moods: ["chill", "late-night"] },
    "Do Guna": { album: "Lunch Break", year: 2023, moods: ["hype"] },
    "Gandi Aulaad": { album: "Nayaab", year: 2022, moods: ["dark", "hype"] },
    "Hola Amigo": { album: "Lunch Break", year: 2023, moods: ["hype", "chill"] },
    "Holi Re Rasiya": { album: "Singles & Collabs", year: 2024, moods: ["chill"] },
    "Hoshiyaar": { album: "Nayaab", year: 2022, moods: ["dark"] },
    "Jama Kar": { album: "Singles & Collabs", year: 2024, moods: ["hype"] },
    "Joint In The Booth": { album: "Lunch Break", year: 2023, moods: ["hype", "dark"] },
    "Kaanch Ke Ghar": { album: "Lunch Break", year: 2023, moods: ["dark", "late-night"] },
    "Khatta Flow": { album: "Lunch Break", year: 2023, moods: ["hype"] },
    "Khoj": { album: "Nayaab", year: 2022, moods: ["dark", "late-night"] },
    "Kodak": { album: "Singles & Collabs", year: 2024, moods: ["chill"] },
    "Kyu": { album: "Nayaab", year: 2022, moods: ["late-night", "chill"] },
    "MMM": { album: "Bayaan & Early Cuts", year: 2019, moods: ["hype"] },
    "Maina": { album: "Lunch Break", year: 2023, moods: ["chill", "late-night"] },
    "Naamcheen": { album: "Lunch Break", year: 2023, moods: ["hype", "dark"] },
    "Nadaan": { album: "Singles & Collabs", year: 2024, moods: ["chill"] },
    "Nafrat": { album: "Singles & Collabs", year: 2024, moods: ["dark"] },
    "Nalla Freestyle": { album: "Bayaan & Early Cuts", year: 2019, moods: ["hype"] },
    "Namastute": { album: "Bayaan & Early Cuts", year: 2018, moods: ["hype", "dark"] },
    "Nanchaku": { album: "Bayaan & Early Cuts", year: 2019, moods: ["hype"] },
    "Nawazuddin": { album: "Singles & Collabs", year: 2024, moods: ["dark"] },
    "Nayaab": { album: "Nayaab", year: 2022, moods: ["dark", "late-night"] },
    "Nazarbhattu Freestyle": { album: "Bayaan & Early Cuts", year: 2019, moods: ["hype"] },
    "RED": { album: "Singles & Collabs", year: 2024, moods: ["dark", "hype"] },
    "Raat Ki Rani": { album: "Lunch Break", year: 2023, moods: ["late-night", "chill"] },
    "Soyi Nahi": { album: "Singles & Collabs", year: 2024, moods: ["late-night"] },
    "Swah": { album: "Lunch Break", year: 2023, moods: ["hype"] },
    "TT Shutdown - Seedhe Maut": { album: "Lunch Break", year: 2023, moods: ["hype", "dark"] },
    "Teen Dost": { album: "Bayaan & Early Cuts", year: 2019, moods: ["chill", "late-night"] },
    "Toh Kya": { album: "Bayaan & Early Cuts", year: 2019, moods: ["dark"] },
    "Tour Shit": { album: "Lunch Break", year: 2023, moods: ["hype"] }
};

const THEME_DESCRIPTIONS = {
    dynamic: "Artwork-driven live theme",
    dark: "Clean dark studio look",
    glass: "Frosted premium finish",
    neon: "Electric performance mode",
    nayaab: "Moody emerald depth",
    bayaan: "Rust-red early era grit",
    lunchbreak: "Burnt-orange tour heat"
};

export async function loadCatalog() {
    const response = await fetch("songs.json");
    const rawSongs = await response.json();

    const songs = rawSongs.map((song, index) => {
        const meta = SONG_META[song.name] || {};
        const albumName = meta.album || "Singles & Collabs";
        const album = ALBUM_META[albumName];
        return {
            ...song,
            id: slugify(`${song.name}-${index}`),
            slug: slugify(song.name),
            album: albumName,
            albumSlug: slugify(albumName),
            year: meta.year || album.year,
            moods: meta.moods || ["hype"],
            theme: album.theme,
            facts: [
                `${song.name} sits inside the ${albumName} lane.`,
                `${album.description} This track is tagged for ${((meta.moods || ["hype"]).join(", "))}.`
            ],
            notes: `${song.name} is grouped under ${albumName} for a cleaner fan-library experience.`,
            lyricsAsset: `lyrics/${slugify(song.name)}.lrc`,
            lyrics: {
                mode: "static",
                lines: [
                    "No synced lyrics file is stored locally for this song yet.",
                    `Drop an LRC file at lyrics/${slugify(song.name)}.lrc to enable word-by-time fan mode.`,
                    `${song.name} stays fully playable meanwhile, with notes, facts, and theme context still available here.`
                ]
            },
            addedOrder: rawSongs.length - index
        };
    });

    const albums = Object.entries(groupBy(songs, (song) => song.album)).map(([name, albumSongs]) => ({
        id: slugify(name),
        name,
        year: ALBUM_META[name]?.year || albumSongs[0]?.year || 2024,
        theme: ALBUM_META[name]?.theme || "dynamic",
        description: ALBUM_META[name]?.description || "Library grouping",
        songs: albumSongs.sort((a, b) => a.name.localeCompare(b.name)),
        image: albumSongs[0]?.image || "songs/default.jpg"
    })).sort((a, b) => b.year - a.year);

    const moodPlaylists = [
        { id: "hype", name: "Hype", songIds: songs.filter((song) => song.moods.includes("hype")).map((song) => song.id) },
        { id: "chill", name: "Chill", songIds: songs.filter((song) => song.moods.includes("chill")).map((song) => song.id) },
        { id: "dark", name: "Dark", songIds: songs.filter((song) => song.moods.includes("dark")).map((song) => song.id) },
        { id: "late-night", name: "Late Night", songIds: songs.filter((song) => song.moods.includes("late-night")).map((song) => song.id) }
    ];

    return { songs, albums, moodPlaylists, themeDescriptions: THEME_DESCRIPTIONS };
}
