const STORAGE_KEY = "seedhemaut-premium-state";

const DEFAULTS = {
    theme: "dynamic",
    favorites: [],
    playlists: [],
    sortBy: "name",
    libraryView: "grid",
    filterFavoritesOnly: false,
    playbackSpeed: 1,
    volume: 0.85,
    repeatMode: "off",
    shuffleEnabled: false,
    lastSongId: null,
    playStats: {},
    sessionCount: 0
};

export function loadPreferences() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return { ...DEFAULTS, ...parsed };
    } catch (error) {
        return { ...DEFAULTS };
    }
}

export function savePreferences(partialState) {
    const next = { ...loadPreferences(), ...partialState };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function buildExportPayload(state) {
    return {
        exportedAt: new Date().toISOString(),
        favorites: state.favorites,
        playlists: state.playlists,
        theme: state.theme,
        playStats: state.playStats
    };
}

export function normalizeImportedPayload(payload) {
    return {
        favorites: Array.isArray(payload.favorites) ? payload.favorites : [],
        playlists: Array.isArray(payload.playlists) ? payload.playlists : [],
        theme: typeof payload.theme === "string" ? payload.theme : "dynamic",
        playStats: payload.playStats && typeof payload.playStats === "object" ? payload.playStats : {}
    };
}
