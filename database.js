const DB_NAME = "seedhemaut-premium-db";
const DB_VERSION = 1;
const HISTORY_STORE = "history";

let dbPromise = null;

function openDatabase() {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                const store = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
                store.createIndex("playedAt", "playedAt");
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return dbPromise;
}

export async function saveHistoryEntry(entry) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, "readwrite");
        tx.objectStore(HISTORY_STORE).put(entry);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadHistoryEntries(limit = 60) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, "readonly");
        const request = tx.objectStore(HISTORY_STORE).getAll();
        request.onsuccess = () => {
            const sorted = request.result.sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
            resolve(sorted.slice(0, limit));
        };
        request.onerror = () => reject(request.error);
    });
}
