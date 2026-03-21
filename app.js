import { loadCatalog } from "./catalog.js";
import { loadHistoryEntries, saveHistoryEntry } from "./database.js";
import { loadLyricsForSong, getActiveLyricIndex } from "./lyrics.js";
import { registerPwa } from "./pwa.js";
import { buildExportPayload, loadPreferences, normalizeImportedPayload, savePreferences } from "./storage.js";
import { clamp, debounce, downloadJson, formatTime, moveItem, readJsonFile } from "./utils.js";

const LIBRARY_PAGE_SIZE = 24;

export async function createApp() {
    const dom = getDom();
    const audio = dom.audio;
    const prefs = loadPreferences();
    const colorThief = window.ColorThief ? new ColorThief() : null;
    const mediaMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const [{ songs, albums, moodPlaylists, themeDescriptions }, historyEntries] = await Promise.all([
        loadCatalog(),
        loadHistoryEntries().catch(() => [])
    ]);

    if (!songs.length) {
        throw new Error("No songs were loaded from songs.json");
    }

    const state = {
        songs,
        albums,
        moodPlaylists,
        themeDescriptions,
        historyEntries,
        favorites: prefs.favorites || [],
        playlists: prefs.playlists || [],
        sortBy: prefs.sortBy || "name",
        libraryView: prefs.libraryView || "grid",
        filterFavoritesOnly: Boolean(prefs.filterFavoritesOnly),
        theme: prefs.theme || "dynamic",
        playbackSpeed: Number(prefs.playbackSpeed || 1),
        volume: Number(prefs.volume ?? 0.85),
        repeatMode: prefs.repeatMode || "off",
        shuffleEnabled: Boolean(prefs.shuffleEnabled),
        visualizerEnabled: prefs.visualizerEnabled !== false,
        activeTab: "library",
        currentSongId: prefs.lastSongId || songs[0]?.id || null,
        queue: songs.map((song) => song.id),
        queueLabel: "All songs",
        queueIndex: 0,
        sleepTimerMinutes: "off",
        searchQuery: "",
        playStats: prefs.playStats || {},
        sessionCount: Number(prefs.sessionCount || 0) + 1,
        selectedPlaylistId: prefs.playlists?.[0]?.id || null,
        accent: [145, 255, 162],
        lyrics: { mode: "static", lines: [] },
        activeLyricIndex: -1,
        renderedSongCount: LIBRARY_PAGE_SIZE,
        reducedMotion: Boolean(mediaMotionQuery?.matches),
        hasLoggedCurrentPlay: false,
        activeQueueDragIndex: null,
        activePlaylistDragIndex: null
    };

    let sleepTimeoutId = null;
    let audioContext = null;
    let analyser = null;
    let frequencyData = null;
    let waveformData = null;
    let visualizerId = 0;
    let particlesId = 0;
    let lyricScrollFrame = 0;
    let activeSongLoadId = 0;

    audio.volume = clamp(state.volume, 0, 1);
    audio.playbackRate = state.playbackSpeed;
    dom.volumeSlider.value = String(audio.volume);
    applyTheme(state.theme);
    setQueue(state.queue, resolveInitialSong().id, "All songs", false);
    attachEvents();
    registerPwa();
    renderAll();
    startParticles();
    dom.loader.classList.add("hidden");

    function resolveInitialSong() {
        const url = new URL(window.location.href);
        const slug = url.searchParams.get("song");
        const song = songs.find((item) => item.slug === slug) || songs.find((item) => item.id === state.currentSongId) || songs[0];
        const theme = url.searchParams.get("theme");
        if (theme && state.themeDescriptions[theme]) {
            state.theme = theme;
            applyTheme(theme);
        }
        return song;
    }

    function saveState() {
        savePreferences({
            favorites: state.favorites,
            playlists: state.playlists,
            sortBy: state.sortBy,
            libraryView: state.libraryView,
            filterFavoritesOnly: state.filterFavoritesOnly,
            theme: state.theme,
            playbackSpeed: state.playbackSpeed,
            volume: audio.volume,
            repeatMode: state.repeatMode,
            shuffleEnabled: state.shuffleEnabled,
            visualizerEnabled: state.visualizerEnabled,
            lastSongId: state.currentSongId,
            playStats: state.playStats,
            sessionCount: state.sessionCount
        });
    }

    function getSong(songId) {
        return state.songs.find((song) => song.id === songId);
    }

    function currentSong() {
        return getSong(state.currentSongId);
    }

    function buildPlayableList() {
        const list = visibleSongs();
        return list.length ? list : state.songs;
    }

    function setQueue(songIds, currentId, label, autoplay = true) {
        const nextQueue = songIds.slice();
        if (currentId && !nextQueue.includes(currentId)) {
            nextQueue.unshift(currentId);
        }
        state.queue = nextQueue;
        state.queueLabel = label;
        state.currentSongId = currentId || state.queue[0] || null;
        state.queueIndex = Math.max(0, state.queue.indexOf(state.currentSongId));
        saveState();
        loadCurrentSong(autoplay);
    }

    async function loadCurrentSong(autoplay) {
        const song = currentSong();
        if (!song) {
            return;
        }
        const songLoadId = ++activeSongLoadId;

        state.hasLoggedCurrentPlay = false;
        state.activeLyricIndex = -1;
        state.lyrics = { mode: "static", lines: [] };

        audio.src = song.path;
        audio.load();
        audio.playbackRate = state.playbackSpeed;
        dom.songImage.src = song.image;
        dom.songTitle.textContent = song.name;
        dom.albumEyebrow.textContent = `${song.album} • ${song.year}`;
        dom.songMetaTags.innerHTML = song.moods.map((mood) => `<span class="tag">${mood}</span>`).join("");
        dom.songStatus.textContent = `${song.name} queued in ${state.queueLabel}`;
        dom.miniTitle.textContent = song.name;
        dom.miniAlbum.textContent = song.album;
        dom.progress.style.width = "0%";
        dom.miniProgress.style.width = "0%";
        dom.currentTime.textContent = "0:00";
        dom.duration.textContent = "0:00";
        dom.songImage.onload = updateArtworkTheme;
        if (dom.songImage.complete) {
            updateArtworkTheme();
        }

        renderAll();
        updateShareUrl(song);

        if (autoplay) {
            play();
        } else {
            updatePlaybackButtons();
        }

        const nextLyrics = await loadLyricsForSong(song);
        if (songLoadId !== activeSongLoadId || state.currentSongId !== song.id) {
            return;
        }
        state.lyrics = nextLyrics;
        renderFan();
    }

    function play() {
        audio.play().then(() => {
            const song = currentSong();
            updatePlaybackButtons();
            if (song && !state.hasLoggedCurrentPlay) {
                state.hasLoggedCurrentPlay = true;
                state.playStats[song.id] = {
                    plays: (state.playStats[song.id]?.plays || 0) + 1,
                    seconds: state.playStats[song.id]?.seconds || 0,
                    lastPlayedAt: new Date().toISOString()
                };
                const entry = {
                    id: `${song.id}-${Date.now()}`,
                    songId: song.id,
                    songName: song.name,
                    playedAt: new Date().toISOString()
                };
                state.historyEntries = [entry, ...state.historyEntries].slice(0, 100);
                saveHistoryEntry(entry).catch(() => {});
            }
            if (state.visualizerEnabled) {
                startVisualizer();
            }
            saveState();
            renderAll();
        }).catch(() => {
            dom.songStatus.textContent = "Tap a control to allow playback";
        });
    }

    function pause() {
        audio.pause();
        updatePlaybackButtons();
        stopVisualizer();
    }

    function next() {
        if (!state.queue.length) {
            return;
        }

        if (state.repeatMode === "one") {
            audio.currentTime = 0;
            play();
            return;
        }

        if (state.queueIndex === state.queue.length - 1 && state.repeatMode === "off") {
            pause();
            audio.currentTime = 0;
            return;
        }

        state.queueIndex = (state.queueIndex + 1) % state.queue.length;
        state.currentSongId = state.queue[state.queueIndex];
        loadCurrentSong(true);
    }

    function prev() {
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            syncLyrics(true);
            return;
        }

        state.queueIndex = state.queueIndex <= 0 ? state.queue.length - 1 : state.queueIndex - 1;
        state.currentSongId = state.queue[state.queueIndex];
        loadCurrentSong(true);
    }

    function renderAll() {
        renderPlayer();
        renderLibrary();
        renderQueue();
        renderPlaylists();
        renderFan();
        renderStats();
        Array.from(document.querySelectorAll(".panel-view")).forEach((panel) => {
            panel.classList.toggle("active", panel.id === `panel-${state.activeTab}`);
        });
        Array.from(document.querySelectorAll(".tab-btn")).forEach((button) => {
            button.classList.toggle("active", button.dataset.tab === state.activeTab);
        });
    }

    function renderPlayer() {
        const song = currentSong();
        dom.viewToggleBtn.textContent = state.libraryView === "grid" ? "List View" : "Grid View";
        dom.favoritesFilterBtn.textContent = state.filterFavoritesOnly ? "All Songs" : "Favorites Only";
        dom.visualizerToggleBtn.textContent = state.visualizerEnabled ? "Visualizer On" : "Visualizer Off";
        dom.favoritesFilterBtn.classList.toggle("is-active", state.filterFavoritesOnly);
        dom.shuffleBtn.classList.toggle("is-active", state.shuffleEnabled);
        dom.repeatBtn.classList.toggle("is-active", state.repeatMode !== "off");
        dom.favoriteBtn.classList.toggle("is-active", state.favorites.includes(state.currentSongId));
        dom.visualizerToggleBtn.classList.toggle("is-active", state.visualizerEnabled);
        dom.shuffleBtn.setAttribute("aria-label", state.shuffleEnabled ? "Shuffle on" : "Shuffle off");
        dom.shuffleBtn.setAttribute("title", state.shuffleEnabled ? "Shuffle on" : "Shuffle off");
        dom.repeatBtn.setAttribute("aria-label", `Repeat ${state.repeatMode}`);
        dom.repeatBtn.setAttribute("title", `Repeat ${state.repeatMode}`);
        dom.themeSelect.value = state.theme;
        dom.sortSelect.value = state.sortBy;
        dom.speedSelect.value = String(state.playbackSpeed);
        dom.sleepTimerSelect.value = state.sleepTimerMinutes;
        dom.muteBtn.textContent = audio.volume === 0 ? "Muted" : `Volume ${Math.round(audio.volume * 100)}%`;
        dom.statusGrid.innerHTML = [
            stat("Queue", `${state.queue.length} tracks`),
            stat("Favorites", `${state.favorites.length} saved`),
            stat("Speed", `${state.playbackSpeed}x`),
            stat("Lyrics", state.lyrics.mode === "synced" ? "Synced" : "Static")
        ].join("");
        dom.recommendationsList.innerHTML = getRecommendations(song?.id)
            .map((item) => `<button class="chip" type="button" data-action="play-song" data-song-id="${item.id}">${item.name}</button>`)
            .join("") || `<span class="chip">Recommendations will build from your listening</span>`;
        dom.moodPlaylists.innerHTML = state.moodPlaylists
            .map((mood) => `<button class="chip" type="button" data-action="load-mood" data-mood-id="${mood.id}">${mood.name}</button>`)
            .join("");
        updatePlaybackButtons();
        document.body.classList.toggle("visualizer-off", !state.visualizerEnabled);
    }

    function visibleSongs() {
        const query = state.searchQuery.trim().toLowerCase();
        return state.songs
            .filter((song) => {
                if (state.filterFavoritesOnly && !state.favorites.includes(song.id)) {
                    return false;
                }

                return !query
                    || song.name.toLowerCase().includes(query)
                    || song.album.toLowerCase().includes(query)
                    || song.moods.join(" ").toLowerCase().includes(query)
                    || String(song.year).includes(query);
            })
            .sort((a, b) => {
                if (state.sortBy === "latest") return b.addedOrder - a.addedOrder;
                if (state.sortBy === "most-played") return (state.playStats[b.id]?.plays || 0) - (state.playStats[a.id]?.plays || 0);
                return a.name.localeCompare(b.name);
            });
    }

    function songCard(song, mode = state.libraryView) {
        const plays = state.playStats[song.id]?.plays || 0;
        const isCurrent = song.id === state.currentSongId;
        return `<article class="song-card ${mode}${isCurrent ? " is-current" : ""}" data-song-id="${song.id}"><img src="${song.image}" alt="${song.name}" loading="lazy"><div class="card-meta"><strong>${song.name}</strong><p class="muted">${song.album} • ${song.year}</p><p class="muted">${song.moods.join(" / ")} • ${plays} plays</p></div><div class="card-actions"><button class="action-btn" type="button" data-action="play-song" data-song-id="${song.id}">Play</button><button class="action-btn" type="button" data-action="play-next" data-song-id="${song.id}">Play Next</button><button class="action-btn" type="button" data-action="add-queue" data-song-id="${song.id}">Add Queue</button><button class="action-btn" type="button" data-action="playlist-add" data-song-id="${song.id}">Add Playlist</button></div></article>`;
    }

    function renderLibrary() {
        const allVisibleSongs = visibleSongs();
        const visibleSlice = allVisibleSongs.slice(0, state.renderedSongCount);
        const recent = state.historyEntries
            .map((entry) => getSong(entry.songId))
            .filter(Boolean)
            .filter((song, index, list) => list.findIndex((item) => item.id === song.id) === index)
            .slice(0, 8);
        const recentAdded = state.songs.slice().sort((a, b) => b.addedOrder - a.addedOrder).slice(0, 8);
        const hasMoreSongs = visibleSlice.length < allVisibleSongs.length;

        dom.libraryPanel.innerHTML = `<div class="section-stack"><section class="panel-card"><div class="section-head"><h3>Library Overview</h3><div class="library-tools"><span class="chip">${allVisibleSongs.length} visible</span><span class="chip">${state.albums.length} album groups</span></div></div><div class="recent-row">${recent.map((song) => `<button class="recent-chip" type="button" data-action="play-song" data-song-id="${song.id}">${song.name}</button>`).join("") || `<span class="chip">Play songs to build history</span>`}</div></section><section class="panel-card"><div class="section-head"><h3>Albums / Eras</h3></div><div class="album-shelf">${state.albums.map((album) => `<article class="album-card"><img src="${album.image}" alt="${album.name}" loading="lazy"><div><strong>${album.name}</strong><p class="muted">${album.year} • ${album.songs.length} songs</p><p class="muted">${album.description}</p></div><div class="card-actions"><button class="action-btn" type="button" data-action="load-album" data-album-id="${album.id}">Open Album</button><button class="action-btn" type="button" data-action="queue-album" data-album-id="${album.id}">Queue Album</button></div></article>`).join("")}</div></section><section class="panel-card"><div class="section-head"><h3>Recently Added</h3></div><div class="collection-grid grid">${recentAdded.map((song) => songCard(song, "grid")).join("")}</div></section><section class="panel-card"><div class="section-head"><h3>All Tracks</h3><div class="collection-tools"><span class="chip">${visibleSlice.length}/${allVisibleSongs.length}</span></div></div><div class="collection-grid ${state.libraryView}">${visibleSlice.map((song) => songCard(song)).join("") || `<div class="placeholder-card">No songs match the current filters.</div>`}</div>${hasMoreSongs ? `<div class="list-footer"><button class="ui-btn" type="button" data-action="load-more-library">Load More</button></div>` : ""}</section></div>`;
    }

    function renderQueue() {
        dom.queuePanel.innerHTML = `<div class="section-stack"><section class="panel-card"><div class="section-head"><h3>Active Queue</h3><div class="collection-tools"><span class="chip">${state.queueLabel}</span><span class="chip">${state.queue.length} items</span></div></div><div class="queue-list">${state.queue.map((songId, index) => { const song = getSong(songId); if (!song) return ""; return `<article class="queue-card${songId === state.currentSongId ? " is-current" : ""}" draggable="true" data-queue-index="${index}"><span class="drag-handle" aria-hidden="true">::</span><img src="${song.image}" alt="${song.name}" loading="lazy"><div class="card-meta"><strong>${song.name}</strong><p class="muted">${song.album}</p></div><div class="queue-actions"><button class="action-btn" type="button" data-action="queue-play" data-queue-index="${index}">Play</button><button class="action-btn" type="button" data-action="queue-remove" data-queue-index="${index}">Remove</button></div></article>`; }).join("")}</div></section></div>`;
    }

    function renderPlaylists() {
        const selected = state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId) || state.playlists[0] || null;
        const tracks = selected ? selected.songIds.map(getSong).filter(Boolean) : [];
        dom.playlistsPanel.innerHTML = `<div class="playlist-layout"><aside class="playlist-sidebar"><div class="playlist-form"><input id="newPlaylistInput" class="inline-input" type="text" placeholder="Create a playlist"><button class="ui-btn" type="button" data-action="create-playlist">Create Playlist</button></div><div class="playlist-toolbar"><button class="ui-btn" type="button" data-action="export-data">Export JSON</button><button class="ui-btn" type="button" data-action="import-data">Import JSON</button></div><div class="playlist-list">${state.playlists.map((playlist) => `<article class="playlist-card${playlist.id === state.selectedPlaylistId ? " active" : ""}" data-action="select-playlist" data-playlist-id="${playlist.id}"><strong>${playlist.name}</strong><p class="muted">${playlist.songIds.length} tracks</p></article>`).join("") || `<div class="placeholder-card">Create your first custom playlist to start curating.</div>`}</div></aside><section class="playlist-editor">${selected ? `<div class="playlist-head"><div><h3>${selected.name}</h3><p class="muted">${tracks.length} tracks • drag to reorder</p></div><div class="playlist-actions"><button class="ui-btn" type="button" data-action="rename-playlist" data-playlist-id="${selected.id}">Rename</button><button class="ui-btn" type="button" data-action="delete-playlist" data-playlist-id="${selected.id}">Delete</button><button class="ui-btn" type="button" data-action="play-playlist" data-playlist-id="${selected.id}">Play Playlist</button></div></div><div class="playlist-song-list">${tracks.map((song, index) => `<article class="playlist-track${song.id === state.currentSongId ? " is-current" : ""}" draggable="true" data-playlist-index="${index}"><span class="drag-handle" aria-hidden="true">::</span><img src="${song.image}" alt="${song.name}" loading="lazy"><div class="card-meta"><strong>${song.name}</strong><p class="muted">${song.album}</p></div><div class="playlist-actions"><button class="action-btn" type="button" data-action="play-song" data-song-id="${song.id}">Play</button><button class="action-btn" type="button" data-action="playlist-remove-song" data-playlist-id="${selected.id}" data-song-id="${song.id}">Remove</button></div></article>`).join("") || `<div class="placeholder-card">Use “Add Playlist” on any song card to build this playlist.</div>`}</div>` : `<div class="placeholder-card">Select or create a playlist to manage it here.</div>`}</section></div>`;
    }

    function renderFan() {
        const song = currentSong();
        if (!song) {
            dom.fanPanel.innerHTML = `<div class="placeholder-card">Select a song to open lyrics and fan mode.</div>`;
            return;
        }

        const lyricModeLabel = state.lyrics.mode === "synced" ? "Synced LRC" : "Static fallback";
        const lyricLines = state.lyrics.lines.map((line, index) => `<article class="lyric-card${index === state.activeLyricIndex ? " active" : ""}" data-lyric-index="${index}">${line.time !== undefined ? `<span class="lyric-time">${formatTime(line.time)}</span>` : ""}<p>${line.text}</p></article>`).join("") || `<article class="lyric-card active"><p>No local lyric data loaded for this song yet.</p></article>`;

        dom.fanPanel.innerHTML = `<div class="fan-layout"><section class="lyrics-panel"><div class="section-head"><h3>Lyrics Panel</h3><div class="collection-tools"><span class="chip">${lyricModeLabel}</span><span class="chip">${song.album}</span></div></div><div class="lyrics-list" id="lyricsList">${lyricLines}</div></section><aside class="facts-panel"><div><h3>Song Facts</h3><div class="fact-list">${song.facts.map((fact) => `<span class="chip">${fact}</span>`).join("")}</div></div><div><h3>Fan Notes</h3><p class="muted">${song.notes}</p></div><div><h3>Era Themes</h3><div class="theme-list">${Object.keys(state.themeDescriptions).map((theme) => `<button class="chip${state.theme === theme ? " is-active" : ""}" type="button" data-action="set-theme" data-theme="${theme}">${theme}</button>`).join("")}</div></div><div><h3>Local Lyrics</h3><p class="muted">Drop an LRC file at <code>${song.lyricsAsset}</code> to unlock full synced lyrics for this track.</p></div><div><h3>Easter Egg</h3><button class="ui-btn" type="button" data-action="easter-egg">Trigger hidden line</button></div></aside></div>`;
        syncLyrics(true);
    }

    function renderStats() {
        const totalPlays = Object.values(state.playStats).reduce((sum, entry) => sum + (entry.plays || 0), 0);
        const totalSeconds = Object.values(state.playStats).reduce((sum, entry) => sum + (entry.seconds || 0), 0);
        const uniqueTracks = Object.keys(state.playStats).length;
        dom.statsPanel.innerHTML = `<div class="section-stack"><section class="stats-grid">${statCard("Total Plays", totalPlays)}${statCard("Listening Time", `${Math.floor(totalSeconds / 60)} min`)}${statCard("Unique Tracks", uniqueTracks)}${statCard("Sessions", state.sessionCount)}</section><section class="panel-card"><div class="section-head"><h3>Most Played Songs</h3></div><div class="collection-grid list">${state.songs.slice().sort((a, b) => (state.playStats[b.id]?.plays || 0) - (state.playStats[a.id]?.plays || 0)).slice(0, 5).map((song) => songCard(song, "list")).join("") || `<div class="placeholder-card">Your analytics will grow after a few listening sessions.</div>`}</div></section></div>`;
    }

    function getRecommendations(songId) {
        const base = getSong(songId) || state.songs[0];
        return state.songs
            .filter((song) => song.id !== base.id)
            .map((song) => ({
                song,
                score: song.moods.filter((mood) => base.moods.includes(mood)).length * 3
                    + Number(song.album === base.album) * 2
                    + (state.playStats[song.id]?.plays || 0)
                    + Number(state.favorites.includes(song.id)) * 4
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((entry) => entry.song);
    }

    function attachEvents() {
        audio.addEventListener("timeupdate", () => {
            if (!audio.duration) {
                return;
            }

            const progress = (audio.currentTime / audio.duration) * 100;
            dom.progress.style.width = `${progress}%`;
            dom.miniProgress.style.width = `${progress}%`;
            dom.currentTime.textContent = formatTime(audio.currentTime);
            dom.duration.textContent = formatTime(audio.duration);
            syncLyrics();

            if (state.currentSongId) {
                state.playStats[state.currentSongId] = {
                    plays: state.playStats[state.currentSongId]?.plays || 0,
                    seconds: Math.round(audio.currentTime),
                    lastPlayedAt: new Date().toISOString()
                };
            }
        });

        audio.addEventListener("play", () => {
            updatePlaybackButtons();
            if (state.visualizerEnabled) {
                startVisualizer();
            }
        });

        audio.addEventListener("pause", () => {
            updatePlaybackButtons();
            stopVisualizer();
        });

        audio.addEventListener("loadedmetadata", () => {
            dom.duration.textContent = formatTime(audio.duration);
            syncLyrics(true);
        });

        audio.addEventListener("ended", next);
        dom.playPauseBtn.addEventListener("click", () => audio.paused ? play() : pause());
        dom.miniPlayPauseBtn.addEventListener("click", () => audio.paused ? play() : pause());
        dom.prevBtn.addEventListener("click", prev);
        dom.nextBtn.addEventListener("click", next);
        dom.miniNextBtn.addEventListener("click", next);
        dom.shuffleBtn.addEventListener("click", () => {
            if (!state.queue.length) return;
            state.shuffleEnabled = !state.shuffleEnabled;
            state.queue = buildShuffledQueue(state.shuffleEnabled);
            state.queueIndex = state.queue.indexOf(state.currentSongId);
            renderPlayer();
            renderQueue();
            saveState();
            showToast(state.shuffleEnabled ? "Shuffle on" : "Shuffle off");
        });
        dom.repeatBtn.addEventListener("click", () => {
            state.repeatMode = { off: "all", all: "one", one: "off" }[state.repeatMode];
            renderPlayer();
            saveState();
            showToast(`Repeat ${state.repeatMode}`);
        });
        dom.favoriteBtn.addEventListener("click", () => toggleFavorite(state.currentSongId));
        dom.surpriseBtn.addEventListener("click", () => {
            const random = state.songs[Math.floor(Math.random() * state.songs.length)];
            setQueue(buildPlayableList().map((song) => song.id), random.id, "Surprise mix", true);
        });
        dom.rewindBtn.addEventListener("click", () => {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
            syncLyrics(true);
        });
        dom.forwardBtn.addEventListener("click", () => {
            audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
            syncLyrics(true);
        });
        dom.viewToggleBtn.addEventListener("click", () => {
            state.libraryView = state.libraryView === "grid" ? "list" : "grid";
            renderLibrary();
            renderPlayer();
            saveState();
        });
        dom.favoritesFilterBtn.addEventListener("click", () => {
            state.filterFavoritesOnly = !state.filterFavoritesOnly;
            state.renderedSongCount = LIBRARY_PAGE_SIZE;
            renderLibrary();
            renderPlayer();
            saveState();
        });
        dom.shareCurrentBtn.addEventListener("click", copyShareUrl);
        dom.helpBtn.addEventListener("click", () => dom.helpModal.showModal());
        dom.visualizerToggleBtn.addEventListener("click", () => {
            state.visualizerEnabled = !state.visualizerEnabled;
            renderPlayer();
            saveState();
            if (state.visualizerEnabled && !audio.paused) {
                startVisualizer();
            } else {
                stopVisualizer(true);
            }
        });
        dom.fullscreenBtn.addEventListener("click", async () => {
            if (document.fullscreenElement) {
                await document.exitFullscreen?.();
            } else {
                await dom.playerStage.requestFullscreen?.();
            }
        });
        dom.volumeSlider.addEventListener("input", (event) => {
            audio.volume = clamp(Number(event.target.value), 0, 1);
            state.volume = audio.volume;
            dom.muteBtn.textContent = audio.volume === 0 ? "Muted" : `Volume ${Math.round(audio.volume * 100)}%`;
            saveState();
        });
        dom.muteBtn.addEventListener("click", () => {
            audio.volume = audio.volume === 0 ? state.volume || 0.85 : 0;
            dom.volumeSlider.value = String(audio.volume);
            if (audio.volume > 0) {
                state.volume = audio.volume;
            }
            dom.muteBtn.textContent = audio.volume === 0 ? "Muted" : `Volume ${Math.round(audio.volume * 100)}%`;
            saveState();
        });
        dom.speedSelect.addEventListener("change", (event) => {
            state.playbackSpeed = Number(event.target.value);
            audio.playbackRate = state.playbackSpeed;
            renderPlayer();
            saveState();
        });
        dom.sleepTimerSelect.addEventListener("change", (event) => {
            clearTimeout(sleepTimeoutId);
            state.sleepTimerMinutes = event.target.value;
            if (event.target.value !== "off") {
                sleepTimeoutId = window.setTimeout(() => {
                    pause();
                    state.sleepTimerMinutes = "off";
                    renderPlayer();
                    saveState();
                }, Number(event.target.value) * 60000);
            }
            renderPlayer();
            saveState();
        });
        dom.themeSelect.addEventListener("change", (event) => {
            applyTheme(event.target.value);
            updateArtworkTheme();
            renderFan();
        });
        dom.sortSelect.addEventListener("change", (event) => {
            state.sortBy = event.target.value;
            state.renderedSongCount = LIBRARY_PAGE_SIZE;
            renderLibrary();
            saveState();
        });
        dom.searchInput.addEventListener("input", debounce((event) => {
            state.searchQuery = event.target.value;
            state.renderedSongCount = LIBRARY_PAGE_SIZE;
            renderLibrary();
        }, 180));
        dom.progressBar.addEventListener("click", (event) => {
            if (!audio.duration) return;
            const bounds = dom.progressBar.getBoundingClientRect();
            audio.currentTime = ((event.clientX - bounds.left) / bounds.width) * audio.duration;
            syncLyrics(true);
        });
        dom.progressBar.addEventListener("mousemove", (event) => {
            if (!audio.duration) return;
            const bounds = dom.progressBar.getBoundingClientRect();
            const offset = clamp(event.clientX - bounds.left, 0, bounds.width);
            dom.progressPreview.textContent = formatTime((offset / bounds.width) * audio.duration);
            dom.progressPreview.style.left = `${offset}px`;
            dom.progressPreview.classList.add("visible");
        });
        dom.progressBar.addEventListener("mouseleave", () => dom.progressPreview.classList.remove("visible"));
        dom.tabBar.addEventListener("click", (event) => {
            const tab = event.target.closest("[data-tab]")?.dataset.tab;
            if (tab) {
                state.activeTab = tab;
                renderAll();
            }
        });
        document.addEventListener("click", handleActionClick);
        dom.importInput.addEventListener("change", async (event) => {
            const [file] = event.target.files || [];
            if (file) {
                const payload = normalizeImportedPayload(await readJsonFile(file));
                state.favorites = payload.favorites;
                state.playlists = payload.playlists;
                state.selectedPlaylistId = state.playlists[0]?.id || null;
                state.theme = payload.theme;
                state.playStats = payload.playStats;
                state.visualizerEnabled = payload.visualizerEnabled;
                applyTheme(state.theme);
                renderAll();
                saveState();
                showToast("Player data imported");
            }
            event.target.value = "";
        });
        document.addEventListener("keydown", (event) => {
            if (event.target.matches("input,select,textarea")) return;
            if (event.code === "Space") {
                event.preventDefault();
                audio.paused ? play() : pause();
            } else if (event.code === "ArrowRight") next();
            else if (event.code === "ArrowLeft") prev();
            else if (event.key.toLowerCase() === "f") toggleFavorite(state.currentSongId);
            else if (event.key.toLowerCase() === "s") dom.shuffleBtn.click();
            else if (event.key.toLowerCase() === "r") dom.repeatBtn.click();
            else if (event.key === "?") dom.helpModal.showModal();
            else if (event.key.toLowerCase() === "q") { state.activeTab = "queue"; renderAll(); }
            else if (event.key.toLowerCase() === "l") { state.activeTab = "library"; renderAll(); }
        });
        document.addEventListener("dragstart", (event) => {
            const queueCard = event.target.closest("[data-queue-index]");
            const playlistTrack = event.target.closest("[data-playlist-index]");
            if (queueCard) {
                state.activeQueueDragIndex = Number(queueCard.dataset.queueIndex);
                queueCard.classList.add("dragging");
            }
            if (playlistTrack) {
                state.activePlaylistDragIndex = Number(playlistTrack.dataset.playlistIndex);
                playlistTrack.classList.add("dragging");
            }
        });
        document.addEventListener("dragend", (event) => {
            event.target.closest(".dragging")?.classList.remove("dragging");
            state.activeQueueDragIndex = null;
            state.activePlaylistDragIndex = null;
        });
        document.addEventListener("dragover", (event) => {
            if (event.target.closest("[data-queue-index], [data-playlist-index]")) {
                event.preventDefault();
            }
        });
        document.addEventListener("drop", (event) => {
            const queueTarget = event.target.closest("[data-queue-index]");
            if (queueTarget && state.activeQueueDragIndex !== null) {
                state.queue = moveItem(state.queue, state.activeQueueDragIndex, Number(queueTarget.dataset.queueIndex));
                state.queueIndex = state.queue.indexOf(state.currentSongId);
                renderQueue();
                saveState();
                return;
            }
            const playlistTarget = event.target.closest("[data-playlist-index]");
            if (playlistTarget && state.activePlaylistDragIndex !== null) {
                const selected = state.playlists.find((item) => item.id === state.selectedPlaylistId);
                if (selected) {
                    selected.songIds = moveItem(selected.songIds, state.activePlaylistDragIndex, Number(playlistTarget.dataset.playlistIndex));
                    renderPlaylists();
                    saveState();
                }
            }
        });

        mediaMotionQuery?.addEventListener?.("change", (event) => {
            state.reducedMotion = event.matches;
            stopVisualizer(true);
            cancelAnimationFrame(particlesId);
            startParticles();
            if (!audio.paused && state.visualizerEnabled) {
                startVisualizer();
            }
        });

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                stopVisualizer(true);
                cancelAnimationFrame(particlesId);
                return;
            }

            startParticles();
            if (!audio.paused && state.visualizerEnabled && !state.reducedMotion) {
                startVisualizer();
            }
        });
    }

    function handleActionClick(event) {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const { action, songId, albumId, playlistId, moodId, queueIndex } = button.dataset;

        if (action === "play-song") {
            const songIds = buildPlayableList().map((song) => song.id);
            setQueue(songIds, songId, state.searchQuery ? "Search results" : "All songs", true);
        } else if (action === "play-next") {
            state.queue.splice(state.queueIndex + 1, 0, songId);
            renderQueue();
            renderPlayer();
            saveState();
        } else if (action === "add-queue") {
            state.queue.push(songId);
            renderQueue();
            renderPlayer();
            saveState();
        } else if (action === "playlist-add") {
            addToPlaylist(songId);
        } else if (action === "queue-play") {
            state.queueIndex = Number(queueIndex);
            state.currentSongId = state.queue[state.queueIndex];
            loadCurrentSong(true);
        } else if (action === "queue-remove") {
            removeQueueItem(Number(queueIndex));
        } else if (action === "create-playlist") {
            createPlaylist();
        } else if (action === "select-playlist") {
            state.selectedPlaylistId = playlistId;
            renderPlaylists();
            saveState();
        } else if (action === "rename-playlist") {
            renamePlaylist(playlistId);
        } else if (action === "delete-playlist") {
            state.playlists = state.playlists.filter((item) => item.id !== playlistId);
            state.selectedPlaylistId = state.playlists[0]?.id || null;
            renderPlaylists();
            saveState();
        } else if (action === "play-playlist") {
            const playlist = state.playlists.find((item) => item.id === playlistId);
            if (playlist?.songIds.length) setQueue(playlist.songIds, playlist.songIds[0], playlist.name, true);
        } else if (action === "playlist-remove-song") {
            removeFromPlaylist(playlistId, songId);
        } else if (action === "export-data") {
            downloadJson("seedhemaut-player-data.json", buildExportPayload(state));
        } else if (action === "import-data") {
            dom.importInput.click();
        } else if (action === "load-mood") {
            const mood = state.moodPlaylists.find((item) => item.id === moodId);
            if (mood?.songIds.length) setQueue(mood.songIds, mood.songIds[0], `${mood.name} mood`, true);
        } else if (action === "load-album") {
            const album = state.albums.find((item) => item.id === albumId);
            if (album) {
                state.searchQuery = album.name;
                state.renderedSongCount = LIBRARY_PAGE_SIZE;
                dom.searchInput.value = album.name;
                state.activeTab = "library";
                renderAll();
            }
        } else if (action === "queue-album") {
            const album = state.albums.find((item) => item.id === albumId);
            if (album?.songs.length) setQueue(album.songs.map((song) => song.id), album.songs[0].id, album.name, true);
        } else if (action === "set-theme") {
            applyTheme(button.dataset.theme);
            updateArtworkTheme();
            renderAll();
        } else if (action === "easter-egg") {
            showToast("Seedhe Maut in the house. Fan mode unlocked.");
        } else if (action === "load-more-library") {
            state.renderedSongCount += LIBRARY_PAGE_SIZE;
            renderLibrary();
        }
    }

    function createPlaylist() {
        const input = document.getElementById("newPlaylistInput");
        const name = input?.value.trim();
        if (!name) return;
        const playlist = { id: `${Date.now()}`, name, songIds: [] };
        state.playlists = [...state.playlists, playlist];
        state.selectedPlaylistId = playlist.id;
        input.value = "";
        renderPlaylists();
        saveState();
        showToast("Playlist created");
    }

    function addToPlaylist(songId) {
        const playlist = state.playlists.find((item) => item.id === state.selectedPlaylistId) || state.playlists[0];
        if (!playlist) return showToast("Create a playlist first");
        if (!playlist.songIds.includes(songId)) {
            playlist.songIds.push(songId);
            showToast(`Added to ${playlist.name}`);
        } else {
            showToast("Already in playlist");
        }
        renderPlaylists();
        saveState();
    }

    function renamePlaylist(playlistId) {
        const playlist = state.playlists.find((item) => item.id === playlistId);
        if (!playlist) return;
        const nextName = window.prompt("Rename playlist", playlist.name);
        if (!nextName?.trim()) return;
        playlist.name = nextName.trim();
        renderPlaylists();
        saveState();
        showToast("Playlist renamed");
    }

    function removeFromPlaylist(playlistId, songId) {
        const playlist = state.playlists.find((item) => item.id === playlistId);
        if (!playlist) return;
        playlist.songIds = playlist.songIds.filter((id) => id !== songId);
        renderPlaylists();
        saveState();
    }

    function removeQueueItem(index) {
        if (index < 0 || index >= state.queue.length) return;
        const removedSongId = state.queue[index];
        const wasPlaying = !audio.paused;
        state.queue.splice(index, 1);
        if (!state.queue.length) {
            pause();
            audio.removeAttribute("src");
            audio.load();
            state.currentSongId = null;
            state.queueIndex = 0;
            state.lyrics = { mode: "static", lines: [] };
            state.activeLyricIndex = -1;
            dom.songTitle.textContent = "No track selected";
            dom.albumEyebrow.textContent = "Queue empty";
            dom.songStatus.textContent = "Add tracks to the queue to keep listening";
            dom.songMetaTags.innerHTML = "";
            dom.miniTitle.textContent = "Queue empty";
            dom.miniAlbum.textContent = "Seedhe Maut";
            dom.progress.style.width = "0%";
            dom.miniProgress.style.width = "0%";
            dom.currentTime.textContent = "0:00";
            dom.duration.textContent = "0:00";
            renderQueue();
            renderPlayer();
            renderFan();
            saveState();
            return;
        }
        if (removedSongId === state.currentSongId) {
            state.queueIndex = Math.min(index, state.queue.length - 1);
            state.currentSongId = state.queue[state.queueIndex];
            loadCurrentSong(wasPlaying);
        } else if (index < state.queueIndex) {
            state.queueIndex -= 1;
        }
        renderQueue();
        renderPlayer();
        saveState();
    }

    function toggleFavorite(songId) {
        state.favorites = state.favorites.includes(songId)
            ? state.favorites.filter((id) => id !== songId)
            : [...state.favorites, songId];
        renderAll();
        saveState();
        showToast(state.favorites.includes(songId) ? "Added to favorites" : "Removed from favorites");
    }

    function copyShareUrl() {
        const song = currentSong();
        if (!song) return;
        const url = new URL(window.location.href);
        url.searchParams.set("song", song.slug);
        if (state.theme !== "dynamic") url.searchParams.set("theme", state.theme);
        else url.searchParams.delete("theme");
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(url.toString())
                .then(() => showToast("Shareable song URL copied"))
                .catch(() => showToast("Copy failed. You can still use the address bar URL."));
            return;
        }
        showToast("Copy isn't available here. Use the address bar URL.");
    }

    function updateShareUrl(song) {
        if (!song) return;
        const url = new URL(window.location.href);
        url.searchParams.set("song", song.slug);
        if (state.theme !== "dynamic") url.searchParams.set("theme", state.theme);
        else url.searchParams.delete("theme");
        window.history.replaceState({}, "", url);
    }

    function showToast(message) {
        dom.toast.textContent = message;
        dom.toast.classList.add("visible");
        clearTimeout(showToast.timeoutId);
        showToast.timeoutId = window.setTimeout(() => dom.toast.classList.remove("visible"), 1800);
    }

    function syncLyrics(forceScroll = false) {
        const nextIndex = getActiveLyricIndex(state.lyrics, audio.currentTime);
        if (state.lyrics.mode !== "synced") {
            state.activeLyricIndex = nextIndex;
            return;
        }

        if (nextIndex === state.activeLyricIndex && !forceScroll) {
            return;
        }

        state.activeLyricIndex = nextIndex;
        const lyricNodes = Array.from(dom.fanPanel.querySelectorAll("[data-lyric-index]"));
        lyricNodes.forEach((node) => node.classList.toggle("active", Number(node.dataset.lyricIndex) === state.activeLyricIndex));

        const activeNode = dom.fanPanel.querySelector(`[data-lyric-index="${state.activeLyricIndex}"]`);
        if (activeNode) {
            cancelAnimationFrame(lyricScrollFrame);
            lyricScrollFrame = requestAnimationFrame(() => {
                activeNode.scrollIntoView({
                    block: "nearest",
                    behavior: forceScroll || state.reducedMotion ? "auto" : "smooth"
                });
            });
        }
    }

    function updateArtworkTheme() {
        if (!colorThief || !currentSong()) return;
        try {
            const palette = colorThief.getPalette(dom.songImage, 4);
            const brightest = palette.sort((a, b) => luminance(b) - luminance(a))[0];
            state.accent = brightest;
            document.documentElement.style.setProperty("--accent", rgb(brightest));
            document.documentElement.style.setProperty("--accent-strong", rgb(brightest.map((channel) => Math.max(24, Math.round(channel * 0.62)))));

            if (state.theme !== "dynamic") {
                return;
            }

            const darker = brightest.map((channel) => Math.max(14, Math.round(channel * 0.36)));
            const deep = brightest.map((channel) => Math.max(8, Math.round(channel * 0.18)));
            const corners = ["left top", "right top", "left bottom", "right bottom"];
            document.documentElement.style.setProperty("--bg-one", rgb(deep));
            document.documentElement.style.setProperty("--bg-two", rgb(darker));
            document.documentElement.style.setProperty("--bg-three", rgb(brightest.map((channel) => Math.max(12, Math.round(channel * 0.24)))));
            document.documentElement.style.setProperty("--corner-position", corners[(brightest[0] + brightest[1] + brightest[2]) % corners.length]);
        } catch (error) {
            // Ignore palette extraction failures and keep the current theme.
        }
    }

    function applyTheme(theme) {
        state.theme = theme;
        document.documentElement.dataset.theme = theme === "dynamic" ? currentSong()?.theme || "dynamic" : theme;
        saveState();
    }

    function updatePlaybackButtons() {
        const icon = audio.paused ? "play" : "pause";
        dom.playPauseBtn.innerHTML = `<img src="icons/${icon}.svg" alt="" aria-hidden="true">`;
        dom.miniPlayPauseBtn.innerHTML = `<img src="icons/${icon}.svg" alt="" aria-hidden="true">`;
        dom.playPauseBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
        dom.miniPlayPauseBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    }

    function buildShuffledQueue(enabled) {
        const currentId = state.currentSongId;
        if (!currentId) {
            return enabled ? shuffle(state.queue) : state.queue.slice();
        }
        const rest = state.queue.filter((songId) => songId !== currentId);
        if (enabled) {
            return [currentId, ...shuffle(rest)];
        }

        const ordered = buildPlayableList().map((song) => song.id);
        const withoutCurrent = ordered.filter((songId) => songId !== currentId);
        return currentId ? [currentId, ...withoutCurrent] : withoutCurrent;
    }

    function ensureAudioContext() {
        if (audioContext) {
            return true;
        }

        try {
            audioContext = new AudioContext();
            const source = audioContext.createMediaElementSource(audio);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.85;
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            frequencyData = new Uint8Array(analyser.frequencyBinCount);
            waveformData = new Uint8Array(analyser.fftSize);
            return true;
        } catch (error) {
            state.visualizerEnabled = false;
            renderPlayer();
            saveState();
            return false;
        }
    }

    function startVisualizer() {
        if (!state.visualizerEnabled || state.reducedMotion) {
            stopVisualizer(true);
            return;
        }

        if (!ensureAudioContext()) {
            stopVisualizer(true);
            return;
        }
        audioContext.resume?.();
        const ctx = dom.visualizerCanvas.getContext("2d");

        cancelAnimationFrame(visualizerId);
        const draw = () => {
            visualizerId = requestAnimationFrame(draw);
            const { width, height } = resizeCanvas(dom.visualizerCanvas);
            analyser.getByteFrequencyData(frequencyData);
            analyser.getByteTimeDomainData(waveformData);
            ctx.clearRect(0, 0, width, height);

            const gradient = ctx.createLinearGradient(0, height, width, 0);
            gradient.addColorStop(0, `rgba(${state.accent[0]}, ${state.accent[1]}, ${state.accent[2]}, 0.05)`);
            gradient.addColorStop(1, `rgba(${state.accent[0]}, ${state.accent[1]}, ${state.accent[2]}, 0.42)`);

            const barCount = Math.min(48, frequencyData.length);
            const step = Math.floor(frequencyData.length / barCount);
            const barWidth = width / barCount;
            for (let index = 0; index < barCount; index += 1) {
                const value = frequencyData[index * step];
                const barHeight = Math.max(4, (value / 255) * (height * 0.58));
                const x = index * barWidth;
                ctx.fillStyle = gradient;
                roundRect(ctx, x + 1, height - barHeight, barWidth - 5, barHeight, 8);
                ctx.fill();
            }

            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgba(${state.accent[0]}, ${state.accent[1]}, ${state.accent[2]}, 0.8)`;
            waveformData.forEach((value, index) => {
                const x = (index / (waveformData.length - 1)) * width;
                const y = (value / 255) * (height * 0.36) + (height * 0.12);
                if (index === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        };

        draw();
    }

    function stopVisualizer(clear = false) {
        cancelAnimationFrame(visualizerId);
        visualizerId = 0;
        if (clear) {
            const ctx = dom.visualizerCanvas.getContext("2d");
            const { width, height } = resizeCanvas(dom.visualizerCanvas);
            ctx.clearRect(0, 0, width, height);
        }
    }

    function startParticles() {
        const ctx = dom.particleCanvas.getContext("2d");
        const particleCount = state.reducedMotion ? 12 : window.innerWidth < 720 ? 14 : 24;
        const particles = Array.from({ length: particleCount }, () => ({
            x: Math.random(),
            y: Math.random(),
            size: (Math.random() * 2.2) + 0.8,
            vx: (Math.random() - 0.5) * 0.00035,
            vy: (Math.random() - 0.5) * 0.00035
        }));

        cancelAnimationFrame(particlesId);
        const draw = () => {
            particlesId = requestAnimationFrame(draw);
            const { width, height } = resizeCanvas(dom.particleCanvas);
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = `rgba(${state.accent[0]}, ${state.accent[1]}, ${state.accent[2]}, 0.12)`;

            particles.forEach((particle) => {
                particle.x = (particle.x + particle.vx + 1) % 1;
                particle.y = (particle.y + particle.vy + 1) % 1;
                ctx.beginPath();
                ctx.arc(particle.x * width, particle.y * height, particle.size, 0, Math.PI * 2);
                ctx.fill();
            });
        };

        draw();
    }
}

function stat(label, value) {
    return `<div class="stat-card"><span class="muted">${label}</span><strong>${value}</strong></div>`;
}

function statCard(label, value) {
    return `<article class="analytics-card"><span class="muted">${label}</span><strong>${value}</strong></article>`;
}

function rgb(color) {
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function luminance([r, g, b]) {
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function shuffle(list) {
    const next = list.slice();
    for (let index = next.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
    }
    return next;
}

function resizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { width, height };
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function getDom() {
    return {
        loader: document.getElementById("loader"),
        audio: document.getElementById("audioPlayer"),
        particleCanvas: document.getElementById("particleCanvas"),
        visualizerCanvas: document.getElementById("visualizerCanvas"),
        songImage: document.getElementById("songImage"),
        albumEyebrow: document.getElementById("albumEyebrow"),
        songTitle: document.getElementById("songTitle"),
        songStatus: document.getElementById("songStatus"),
        songMetaTags: document.getElementById("songMetaTags"),
        currentTime: document.getElementById("currentTime"),
        duration: document.getElementById("duration"),
        progressBar: document.getElementById("progressBar"),
        progress: document.querySelector(".progress"),
        progressPreview: document.getElementById("progressPreview"),
        shuffleBtn: document.getElementById("shuffleBtn"),
        repeatBtn: document.getElementById("repeatBtn"),
        prevBtn: document.getElementById("prevBtn"),
        playPauseBtn: document.getElementById("playPauseBtn"),
        nextBtn: document.getElementById("nextBtn"),
        favoriteBtn: document.getElementById("favoriteBtn"),
        surpriseBtn: document.getElementById("surpriseBtn"),
        visualizerToggleBtn: document.getElementById("visualizerToggleBtn"),
        fullscreenBtn: document.getElementById("fullscreenBtn"),
        rewindBtn: document.getElementById("rewindBtn"),
        forwardBtn: document.getElementById("forwardBtn"),
        muteBtn: document.getElementById("muteBtn"),
        volumeSlider: document.getElementById("volumeSlider"),
        speedSelect: document.getElementById("speedSelect"),
        sleepTimerSelect: document.getElementById("sleepTimerSelect"),
        statusGrid: document.getElementById("statusGrid"),
        recommendationsList: document.getElementById("recommendationsList"),
        moodPlaylists: document.getElementById("moodPlaylists"),
        tabBar: document.getElementById("tabBar"),
        libraryPanel: document.getElementById("panel-library"),
        queuePanel: document.getElementById("panel-queue"),
        playlistsPanel: document.getElementById("panel-playlists"),
        fanPanel: document.getElementById("panel-fan"),
        statsPanel: document.getElementById("panel-stats"),
        themeSelect: document.getElementById("themeSelect"),
        searchInput: document.getElementById("searchInput"),
        sortSelect: document.getElementById("sortSelect"),
        viewToggleBtn: document.getElementById("viewToggleBtn"),
        favoritesFilterBtn: document.getElementById("favoritesFilterBtn"),
        shareCurrentBtn: document.getElementById("shareCurrentBtn"),
        helpBtn: document.getElementById("helpBtn"),
        helpModal: document.getElementById("helpModal"),
        importInput: document.getElementById("importInput"),
        toast: document.getElementById("toast"),
        miniTitle: document.getElementById("miniTitle"),
        miniAlbum: document.getElementById("miniAlbum"),
        miniPlayPauseBtn: document.getElementById("miniPlayPauseBtn"),
        miniNextBtn: document.getElementById("miniNextBtn"),
        miniProgress: document.getElementById("miniProgressBar"),
        playerStage: document.getElementById("playerStage")
    };
}
