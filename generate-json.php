<?php
$songs = glob("songs/*.mp3");
$songData = [];

foreach ($songs as $song) {
    $songName = pathinfo($song, PATHINFO_FILENAME);
    $formattedSongName = str_replace("_", " ", $songName);

    $imageFormats = ["jpg", "jpeg", "webp"];
    $imagePath = "songs/default.jpg";

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

// Save to JSON file
file_put_contents('songs.json', json_encode($songData, JSON_PRETTY_PRINT));
echo "songs.json has been generated!";
?>