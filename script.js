let audioPlayer = document.getElementById("audioPlayer");
let songImage = document.getElementById("songImage");
let songTitle = document.getElementById("songTitle");
let playPauseBtn = document.getElementById("playPauseBtn");
let progressBar = document.querySelector(".progress");
let progressContainer = document.querySelector(".progress-bar");
let currentTimeEl = document.getElementById("currentTime");
let durationEl = document.getElementById("duration");

let colorThief = new ColorThief();
let currentSongIndex = 0;
let shuffledSongs = [];
let songData = [];

// Fetch songs from JSON file
fetch('songs.json')
    .then(response => response.json())
    .then(data => {
        songData = data;
        shuffledSongs = shuffleArray(songData);
        loadSong(currentSongIndex);
        
        // Remove loader after songs are loaded
        document.getElementById("loader").classList.add("hidden");
        
        // Try autoplay
        let playPromise = audioPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                document.addEventListener("click", enableAudioPlayback, { once: true });
                document.addEventListener("touchstart", enableAudioPlayback, { once: true });
            });
        }
    })
    .catch(error => {
        console.error('Error loading songs:', error);
        document.getElementById("loader").classList.add("hidden");
    });

// Load and Play a Song
function loadSong(index) {
    const song = shuffledSongs[index];
    audioPlayer.src = song.path;
    songImage.src = song.image;
    songTitle.textContent = song.name;

    songImage.onload = () => {
        let color = colorThief.getColor(songImage);
        document.body.style.background = `linear-gradient(135deg, rgb(${color[0]}, ${color[1]}, ${color[2]}), #3a3a3a)`;
    };

    audioPlayer.load();
    updatePlayButton(false);
}

function enableAudioPlayback() {
    audioPlayer.play().then(() => updatePlayButton(false)).catch(console.log);
}

// Rest of your functions remain the same...
function togglePlay() {
    if (audioPlayer.paused) {
        audioPlayer.play();
        updatePlayButton(false);
    } else {
        audioPlayer.pause();
        updatePlayButton(true);
    }
}

function updatePlayButton(isPaused) {
    playPauseBtn.innerHTML = `<img src="icons/${isPaused ? "play" : "pause"}.svg" alt="${isPaused ? "Play" : "Pause"}">`;
}

function nextSong() {
    currentSongIndex = (currentSongIndex + 1) % shuffledSongs.length;
    loadSong(currentSongIndex);
    audioPlayer.play();
    updatePlayButton(false);
}

function prevSong() {
    currentSongIndex = (currentSongIndex - 1 + shuffledSongs.length) % shuffledSongs.length;
    loadSong(currentSongIndex);
    audioPlayer.play();
    updatePlayButton(false);
}

audioPlayer.addEventListener("timeupdate", () => {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.style.width = `${progress}%`;
        currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
        durationEl.textContent = formatTime(audioPlayer.duration);
    }
});

progressContainer.addEventListener("click", (event) => {
    const width = progressContainer.clientWidth;
    const clickX = event.offsetX;
    audioPlayer.currentTime = (clickX / width) * audioPlayer.duration;
});

function formatTime(time) {
    let minutes = Math.floor(time / 60);
    let seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

function shuffleArray(array) {
    let shuffled = array.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
    } else if (event.code === "ArrowRight") {
        nextSong();
    } else if (event.code === "ArrowLeft") {
        prevSong();
    }
});