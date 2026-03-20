<?php
$songs = glob("songs/*.mp3");
$songData = [];

foreach ($songs as $song) {
    $songName = pathinfo($song, PATHINFO_FILENAME);
    $formattedSongName = str_replace("_", " ", $songName);

    $imageFormats = ["jpg", "jpeg", "webp"];
    $imagePath = "default.jpg";

    foreach ($imageFormats as $format) {
        $possibleImage = "songs/{$songName}.{$format}";
        if (file_exists($possibleImage)) {
            $imagePath = $possibleImage;
            break;
        }
    }


    $songData[] = [
        "path" => $song,
        "image" => $imagePath,
        "name" => $formattedSongName
    ];
}

$songDataJson = json_encode($songData);
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Seedhe Maut Music Player</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="responsive.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/color-thief/2.3.2/color-thief.min.js"></script>
</head>

<body>
    <div id="loader">
        <div class="spinner"></div>
    </div>
    <div class="music-container">
        <img id="songImage" src="default.jpg" alt="Song Image" crossOrigin="Anonymous">
        <h2 id="songTitle">Loading....</h2>
        <audio id="audioPlayer"></audio>
        <div class="progress-container">
            <span id="currentTime">0:00</span>
            <div class="progress-bar">
                <div class="progress"></div>
            </div>
            <span id="duration">0:00</span>
        </div>
        <div class="controls">
            <button onclick="prevSong()">
                <img src="icons/prev.svg" alt="Prev">
            </button>
            <button onclick="togglePlay()" id="playPauseBtn">
                <img src="icons/play.svg" alt="Play">
            </button>
            <button onclick="nextSong()">
                <img src="icons/next.svg" alt="Next">
            </button>
        </div>
    </div>
    <script>
        let songData = <?php echo $songDataJson; ?>;
    </script>
    <script src="script.js"></script>
</body>

</html>