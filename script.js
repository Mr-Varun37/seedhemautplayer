import { createApp } from "./app.js";

createApp().catch((error) => {
    console.error(error);
    const loader = document.getElementById("loader");
    if (loader) {
        loader.classList.remove("hidden");
        loader.innerHTML = `
            <div class="loader-content">
                <p>Couldn’t load the player.</p>
                <p>Please refresh once and check that songs.json is reachable.</p>
            </div>
        `;
    }
});
