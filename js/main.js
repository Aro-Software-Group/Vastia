console.log("main.js loaded");

// Web Audio API Setup
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let currentSource = null;
let audioBuffer = null;
let selectedFile = null; // To store the original selected file

// Placeholder for future JavaScript modules/sections

// File Upload Logic
document.addEventListener('DOMContentLoaded', () => {
    const fileUploadElement = document.getElementById('fileUpload');
    const playButton = document.getElementById('playButton');
    const pauseButton = document.getElementById('pauseButton');
    const stopButton = document.getElementById('stopButton');
    const html5AudioPlayer = document.getElementById('html5AudioPlayer');
    const downloadButton = document.getElementById('downloadButton');
    const fileNameElement = document.getElementById('fileName'); // Added for displaying file name

    const updateButtonStates = (isPlaying = false, isPaused = false, canPlay = false, canDownload = false) => {
        if (playButton) playButton.disabled = isPlaying || !canPlay;
        if (pauseButton) pauseButton.disabled = (!isPlaying || isPaused) || !canPlay;
        if (stopButton) stopButton.disabled = (!isPlaying && !isPaused) || !canPlay;
        if (downloadButton) downloadButton.disabled = !canDownload;
    };

    if (fileUploadElement) {
        fileUploadElement.addEventListener('change', (event) => {
            selectedFile = event.target.files[0]; // Store the selected file
            if (currentSource) { // Stop any existing audio if a new file is selected
                currentSource.stop(0);
                currentSource.disconnect();
                currentSource = null;
            }
            audioContext.resume().then(() => { // Ensure context is not suspended
                 if (audioContext.state === 'suspended') {
                    audioContext.resume();
                 }
            });


            if (selectedFile) {
                console.log("File selected:");
                console.log("Name:", selectedFile.name);
                console.log("Type:", selectedFile.type);
                if (fileNameElement) fileNameElement.textContent = `Selected: ${selectedFile.name}`;
                updateButtonStates(false, false, false, false); // Disable buttons while loading

                // Reset HTML5 player
                if (html5AudioPlayer) {
                    html5AudioPlayer.src = '';
                    URL.revokeObjectURL(html5AudioPlayer.src); // Revoke previous object URL if any
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    audioContext.decodeAudioData(e.target.result, (buffer) => {
                        audioBuffer = buffer;
                        console.log('Audio decoded successfully.');
                        updateButtonStates(false, false, true, true); // Enable play and download

                        if (html5AudioPlayer && selectedFile) {
                            const objectURL = URL.createObjectURL(selectedFile);
                            html5AudioPlayer.src = objectURL;
                            // html5AudioPlayer.load(); // Not strictly necessary with src set
                        }

                    }, (error) => {
                        console.error('Error decoding audio data:', error);
                        audioBuffer = null;
                        selectedFile = null;
                        updateButtonStates(false, false, false, false); // Keep buttons disabled
                    });
                };
                reader.onerror = (error) => {
                    console.error('FileReader error:', error);
                    audioBuffer = null;
                    selectedFile = null;
                    updateButtonStates(false, false, false, false);
                };
                reader.readAsArrayBuffer(selectedFile);

            } else {
                console.log("No file selected.");
                if (fileNameElement) fileNameElement.textContent = ''; // Clear file name
                audioBuffer = null;
                selectedFile = null;
                if (html5AudioPlayer && html5AudioPlayer.src) {
                    URL.revokeObjectURL(html5AudioPlayer.src);
                    html5AudioPlayer.src = '';
                }
                updateButtonStates(false, false, false, false);
            }
        });
    } else {
        console.error("File upload element not found.");
    }

    // Playback Functions
    const playAudio = () => {
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed.');
                if (audioBuffer) { // Check buffer again after resume
                    startPlayback();
                }
            });
        } else if (audioBuffer) {
            startPlayback();
        } else {
            console.log("No audio buffer to play.");
        }
    };

    const startPlayback = () => {
        if (currentSource) { // Stop and clear existing source before playing again
            currentSource.stop(0);
            currentSource.disconnect();
            currentSource = null;
        }
        currentSource = audioContext.createBufferSource();
        currentSource.buffer = audioBuffer;
        currentSource.connect(audioContext.destination);
        currentSource.start(0);
        console.log('Audio playback started.');
        updateButtonStates(true, false, true, !!audioBuffer);

        currentSource.onended = () => {
            console.log('Audio playback finished.');
            // currentSource.disconnect(); // Disconnect is good practice
            // currentSource = null; // Allow re-play
            // When playback ends, user should be able to play again if buffer exists, and download.
            updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);
            if (audioContext.state !== 'suspended') { // Avoid issues if manually stopped then ended
                 // Reset currentTime to allow playing from the beginning next time.
                 // This is implicitly handled by creating a new BufferSource each time.
            }
        };
    };

    const pauseAudio = () => {
        if (currentSource && audioContext.state === 'running') {
            audioContext.suspend().then(() => {
                console.log('Audio paused.');
                updateButtonStates(false, true, true, !!audioBuffer);
            });
        }
    };

    // Resume is handled by playAudio checking context state
    // const resumeAudio = () => {
    //     if (currentSource && audioContext.state === 'suspended') {
    //         audioContext.resume().then(() => {
    //             console.log('Audio resumed.');
    //             updateButtonStates(true, false, true);
    //         });
    //     }
    // };

    const stopAudio = () => {
        if (currentSource) {
            currentSource.stop(0);
            // currentSource.disconnect(); // Disconnect happens in onended or before new play
            // currentSource = null; // onended handles this to allow replay
            console.log('Audio stopped.');
            // No need to reset currentTime explicitly for BufferSource, new source starts at 0
        }
        // If context was suspended by pause, bring it back
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                 updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);
            });
        } else {
            updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);
        }
    };

    // Event Listeners for Buttons
    if (playButton) {
        playButton.addEventListener('click', playAudio);
    }
    if (pauseButton) {
        pauseButton.addEventListener('click', pauseAudio);
    }
    if (stopButton) {
        stopButton.addEventListener('click', stopAudio);
    }

    // Initial button states (Play, Pause, Stop, Download)
    updateButtonStates(false, false, false, false);

    // Download Button Event Listener
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            if (audioBuffer) {
                console.log("Download button clicked. Selected transformation:", selectedTransformation);
                console.log("Functionality to download transformed audio to be implemented.");
                // Future: Implement actual download logic using audioBuffer and selectedTransformation
                // e.g., convert AudioBuffer to WAV, then create a download link
            } else {
                console.log("No audio processed yet for download.");
            }
        });
    }

    // Transformation Options Logic
    const transformationRadios = document.querySelectorAll('input[name="transformation"]');
    let selectedTransformation = '8d'; // Default value

    if (transformationRadios) {
        transformationRadios.forEach(radio => {
            if (radio.checked) { // Initialize with the default checked value
                selectedTransformation = radio.value;
            }
            radio.addEventListener('change', (event) => {
                selectedTransformation = event.target.value;
                console.log("Selected transformation:", selectedTransformation);
                // Future: Trigger audio reprocessing or update parameters
            });
        });
        console.log("Initial transformation:", selectedTransformation); // Log initial value
    }
});

// Transformation Logic - Placeholder for actual audio processing functions
// Audio Player Logic - Will be expanded
// Download Logic
