console.log("main.js loaded");

// Web Audio API Setup
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let currentSource = null;
let audioBuffer = null; // This will now store the processed buffer (or original if no processing)
let selectedFile = null; // To store the original selected file
let originalAudioBuffer = null; // To store the pristine decoded audio
let isProcessing = false; // To track if an audio transformation is in progress
let currentPlayerObjectUrl = null; // For managing the HTML5 player's Object URL

// Placeholder for future JavaScript modules/sections

// File Upload Logic
document.addEventListener('DOMContentLoaded', () => {
    const fileUploadElement = document.getElementById('fileUpload');
    const playButton = document.getElementById('playButton');
    const pauseButton = document.getElementById('pauseButton');
    const stopButton = document.getElementById('stopButton');
    const html5AudioPlayer = document.getElementById('html5AudioPlayer');
    const downloadButton = document.getElementById('downloadButton');
    const fileNameElement = document.getElementById('fileName');
    const transformationRadios = document.querySelectorAll('input[name="transformation"]');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const statusMessageElement = document.getElementById('statusMessage');

    // Function to manage UI state during processing
    const setProcessingState = (isProcessingActive) => {
        isProcessing = isProcessingActive;

        if (isProcessingActive) {
            console.log("Audio processing started...");
            if (loadingIndicator) loadingIndicator.classList.remove('hidden');
            if (statusMessageElement) {
                statusMessageElement.textContent = ''; // Clear previous messages
                statusMessageElement.className = 'text-center my-3 font-medium'; // Reset class
            }
        } else {
            console.log("Audio processing finished.");
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
        }

        transformationRadios.forEach(radio => {
            // Disable radios if processing, or if not processing but no audio is loaded
            radio.disabled = isProcessingActive || (!isProcessingActive && !originalAudioBuffer);
        });

        // Play, Pause, Stop, Download buttons are managed by updateButtonStates,
        // but should also be disabled during processing itself.
        // However, to simplify, we'll let updateButtonStates handle them after processing.
        // For immediate disabling *during* processing:
        if (playButton) playButton.disabled = isProcessingActive || playButton.disabled;
        if (pauseButton) pauseButton.disabled = isProcessingActive || pauseButton.disabled;
        if (stopButton) stopButton.disabled = isProcessingActive || stopButton.disabled;
        if (downloadButton) downloadButton.disabled = isProcessingActive || downloadButton.disabled;


        if (!isProcessingActive) {
            // After processing finishes, re-evaluate button states based on audioBuffer
            updateButtonStates(audioContext.state === 'running' && currentSource, audioContext.state === 'suspended', !!audioBuffer, !!audioBuffer);
        }
    };

    const updateButtonStates = (isPlaying = false, isPaused = false, canPlay = false, canDownload = false) => {
        if (playButton) playButton.disabled = isPlaying || !canPlay;
        if (pauseButton) pauseButton.disabled = (!isPlaying || isPaused) || !canPlay;
        if (stopButton) stopButton.disabled = (!isPlaying && !isPaused) || !canPlay;
        if (downloadButton) downloadButton.disabled = !canDownload;
    };

    if (fileUploadElement) {
        fileUploadElement.addEventListener('change', (event) => {
            selectedFile = event.target.files[0]; // Store the selected file

            // Always stop audio if a new file is chosen or selection is cleared
            if (currentSource) {
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
                if (statusMessageElement) { // Clear previous status messages
                    statusMessageElement.textContent = '';
                    statusMessageElement.className = 'text-center my-3 font-medium';
                }
                transformationRadios.forEach(radio => radio.disabled = false); // Enable radios
                updateButtonStates(false, false, false, false); // Disable playback buttons while loading

                // Reset HTML5 player and revoke old Object URL
                if (html5AudioPlayer) {
                    if (currentPlayerObjectUrl) {
                        URL.revokeObjectURL(currentPlayerObjectUrl);
                        currentPlayerObjectUrl = null;
                    }
                    html5AudioPlayer.src = '';
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    audioContext.decodeAudioData(e.target.result, (buffer) => {
                        originalAudioBuffer = buffer; // Store pristine buffer
                        audioBuffer = originalAudioBuffer; // Initially, processed buffer is the original
                        console.log('Audio decoded successfully.');
                        updateButtonStates(false, false, !!audioBuffer, !!audioBuffer); // Enable play and download after decoding

                        // Set HTML5 player to original audio initially
                        if (html5AudioPlayer && selectedFile) {
                            if (currentPlayerObjectUrl) { // Should be null here due to above reset, but good practice
                                URL.revokeObjectURL(currentPlayerObjectUrl);
                            }
                            currentPlayerObjectUrl = URL.createObjectURL(selectedFile); // Use original file for initial preview
                            html5AudioPlayer.src = currentPlayerObjectUrl;
                        }

                    }, (error) => {
                        console.error('Error decoding audio data:', error);
                        originalAudioBuffer = null;
                        audioBuffer = null;
                        selectedFile = null;
                        updateButtonStates(false, false, false, false); // Keep buttons disabled
                    });
                };
                reader.onerror = (error) => {
                    console.error('FileReader error:', error);
                    originalAudioBuffer = null;
                    audioBuffer = null;
                    selectedFile = null;
                    updateButtonStates(false, false, false, false);
                };
                reader.readAsArrayBuffer(selectedFile);

            } else {
                console.log("No file selected.");
                if (fileNameElement) fileNameElement.textContent = ''; // Clear file name
                originalAudioBuffer = null;
                audioBuffer = null;
                selectedFile = null;
                transformationRadios.forEach(radio => radio.disabled = true); // Disable radios
                if (html5AudioPlayer) {
                     if (currentPlayerObjectUrl) {
                        URL.revokeObjectURL(currentPlayerObjectUrl);
                        currentPlayerObjectUrl = null;
                    }
                    html5AudioPlayer.src = '';
                }
                updateButtonStates(false, false, false, false);
            }
        });
    } else {
        console.error("File upload element not found.");
    }

    // Disable transformation radios initially
    transformationRadios.forEach(radio => radio.disabled = true);

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
            if (audioBuffer && !isProcessing) {
                console.log("Preparing download for:", selectedTransformation);
                try {
                    const wavBlob = audioBufferToWav(audioBuffer);
                    const originalFileName = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "audio";
                    const outputFilename = `${originalFileName}_${selectedTransformation.toUpperCase()}.wav`;

                    const url = URL.createObjectURL(wavBlob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = outputFilename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    console.log("Download started for:", outputFilename);

                } catch (error) {
                    console.error("Error creating WAV file for download:", error);
                    alert("Could not prepare audio for download. " + error.message);
                }
            } else if (isProcessing) {
                console.log("Cannot download while processing is active.");
                alert("Please wait for audio processing to complete before downloading.");
            } else {
                console.log("No audio processed yet for download.");
                alert("No audio available to download. Please upload and process a file first.");
            }
        });
    }

    // Transformation Options Logic
    // const transformationRadios = document.querySelectorAll('input[name="transformation"]'); // Already defined above
    let selectedTransformation = '8d'; // Default value

    if (transformationRadios.length > 0) { // Check if radios were found
        transformationRadios.forEach(radio => {
            if (radio.checked) { // Initialize with the default checked value
                selectedTransformation = radio.value;
            }
            radio.addEventListener('change', (event) => {
                selectedTransformation = event.target.value;
                console.log("Selected transformation:", selectedTransformation);

                if (originalAudioBuffer && !isProcessing) {
                    // Stop any currently playing audio before applying transformation
                    if (audioContext.state === 'running' && currentSource) {
                        console.log("Stopping current audio before transformation.");
                        stopAudio(); // This will also update button states
                    }
                    // Ensure audio context is running if it was suspended (e.g. by pause)
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }

                    setProcessingState(true);

                    let effectPromise;
                    let effectDisplayName; // For user-facing messages

                    if (selectedTransformation === '8d') {
                        console.log(`Applying '8D Effect'...`);
                        effectPromise = apply8DEffect(originalAudioBuffer);
                        effectDisplayName = "8D Effect";
                    } else if (selectedTransformation === '16d' || selectedTransformation === '32d') {
                        // Use StereoWidening as a placeholder for 16D/32D
                        effectDisplayName = `${selectedTransformation} (Stereo Widening placeholder)`;
                        console.log(`Applying placeholder '${effectDisplayName}'...`);
                        effectPromise = applyStereoWidening(originalAudioBuffer);
                    } else {
                        // This case should ideally not be reached if radio values are fixed
                        // but as a fallback, revert to original.
                        console.log(`No specific effect defined for '${selectedTransformation}'. Reverting to original.`);
                        audioBuffer = originalAudioBuffer;
                        if (statusMessageElement) {
                            statusMessageElement.textContent = `No effect applied for '${selectedTransformation}'. Using original audio.`;
                            statusMessageElement.className = 'text-center my-3 font-medium text-gray-600';
                        }
                         // Update HTML5 player to original if it was changed
                        if (html5AudioPlayer && selectedFile) {
                            if (currentPlayerObjectUrl) URL.revokeObjectURL(currentPlayerObjectUrl);
                            currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
                            html5AudioPlayer.src = currentPlayerObjectUrl;
                        }
                        setProcessingState(false); // End processing state
                        // No actual promise to handle, or resolve immediately with original
                        effectPromise = null;
                    }

                    if (effectPromise) {
                        effectPromise.then(renderedBuffer => {
                            audioBuffer = renderedBuffer;
                            const successMsg = `'${effectDisplayName}' applied successfully.`;
                            console.log(successMsg);
                            if (statusMessageElement) {
                                statusMessageElement.textContent = successMsg;
                                statusMessageElement.className = 'text-center my-3 font-medium text-green-600';
                            }

                            // Update HTML5 player with transformed audio
                            if (html5AudioPlayer) {
                                if (currentPlayerObjectUrl) URL.revokeObjectURL(currentPlayerObjectUrl);
                                try {
                                    const playerWavBlob = audioBufferToWav(audioBuffer);
                                    currentPlayerObjectUrl = URL.createObjectURL(playerWavBlob);
                                    html5AudioPlayer.src = currentPlayerObjectUrl;
                                    console.log("HTML5 player updated with transformed audio.");
                                } catch (wavError) {
                                    console.error("Error creating WAV for HTML5 player:", wavError);
                                }
                            }
                        })
                        .catch(error => {
                            const errorMsg = `Error applying '${effectDisplayName}': ${error.message}`;
                            console.error(errorMsg);
                            if (statusMessageElement) {
                                statusMessageElement.textContent = errorMsg;
                                statusMessageElement.className = 'text-center my-3 font-medium text-red-600';
                            }
                            audioBuffer = originalAudioBuffer; // Revert to original
                            // Revert HTML5 player to original
                            if (html5AudioPlayer && selectedFile) {
                                if (currentPlayerObjectUrl) URL.revokeObjectURL(currentPlayerObjectUrl);
                                currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
                                html5AudioPlayer.src = currentPlayerObjectUrl;
                                console.log("HTML5 player reverted to original audio due to processing error.");
                            }
                        })
                        .finally(() => {
                            setProcessingState(false);
                        });
                    }
                } else if (isProcessing) {
                    console.log("Cannot change transformation while processing is active.");
                    // Optionally, revert radio button to previous state or show a message
                    event.target.checked = false; // Quick way to prevent change, needs better UX
                    // Re-check the previously selected radio button
                    const previouslyCheckedRadio = document.querySelector(`input[name="transformation"][value="${selectedTransformation}"]`);
                    if (previouslyCheckedRadio) previouslyCheckedRadio.checked = true;
                }
                // The case for !originalAudioBuffer is handled by radios being disabled.
            });
        });
        console.log("Initial transformation:", selectedTransformation); // Log initial value
    }
});

// Transformation Function (Stereo Widening using Haas Effect) - Placeholder for 16D/32D perhaps
function applyStereoWidening(inputBuffer) { // This can remain as a general widener for other options
    return new Promise((resolve, reject) => {
        try {
            // Ensure OfflineAudioContext is available
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }

            const offlineCtx = new OfflineAudioContext(
                2, // Always output stereo
                inputBuffer.length,
                inputBuffer.sampleRate
            );

            const source = offlineCtx.createBufferSource();
            source.buffer = inputBuffer;

            const merger = offlineCtx.createChannelMerger(2);

            if (inputBuffer.numberOfChannels === 1) { // Mono input
                const delayNode = offlineCtx.createDelay(0.1); // Max delay of 0.1s, can be less
                delayNode.delayTime.value = 0.02; // 20ms delay for Haas effect

                source.connect(merger, 0, 0); // Left output of merger gets original mono

                const gainNode = offlineCtx.createGain(); // Optional: slight gain adjustment for delayed signal
                source.connect(gainNode);
                gainNode.connect(delayNode);
                delayNode.connect(merger, 0, 1); // Right output of merger gets delayed mono

            } else { // Stereo input
                const splitter = offlineCtx.createChannelSplitter(2);
                source.connect(splitter);

                const delayNode = offlineCtx.createDelay(0.1);
                delayNode.delayTime.value = 0.02; // 20ms delay

                // Original left channel to left output
                splitter.connect(merger, 0, 0);

                // Mix original right channel with a delayed version of the left channel for widening
                // This is a common way to do Haas on stereo. Another is to delay one channel slightly.
                // For simplicity here, let's try delaying the right channel itself slightly.
                // splitter.connect(merger, 1, 1); // original right to right
                // splitter.connect(delayNode, 0); // take left channel
                // delayNode.connect(merger, 0, 1); // add delayed left to right (might be too much)

                // Simpler: pass left as is, pass delayed right to right.
                const rightChannelDelay = offlineCtx.createDelay(0.1);
                rightChannelDelay.delayTime.value = 0.02; // Delay right channel

                splitter.connect(merger, 0, 0); // Left channel to Merger's Left input
                splitter.connect(rightChannelDelay, 1); // Right channel from splitter to delay
                rightChannelDelay.connect(merger, 0, 1); // Delayed Right channel to Merger's Right input
            }

            merger.connect(offlineCtx.destination);
            source.start(0);

            offlineCtx.startRendering().then(renderedBuffer => {
                resolve(renderedBuffer);
            }).catch(err => {
                reject(new Error("Rendering failed: " + err.message));
            });

        } catch (error) {
            reject(new Error("Error in applyStereoWidening: " + error.message));
        }
    });
}
// Audio Player Logic - Will be expanded
// Download Logic

// --- WAV Encoding Functions ---
function audioBufferToWav(aBuffer) {
    const numChannels = aBuffer.numberOfChannels;
    const sampleRate = aBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;

    let result;
    if (numChannels === 2) {
        result = interleave(aBuffer.getChannelData(0), aBuffer.getChannelData(1));
    } else {
        result = aBuffer.getChannelData(0);
    }

    const buffer = new ArrayBuffer(44 + result.length * bytesPerSample);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeUTFBytes(view, 0, 'RIFF');
    view.setUint32(4, 36 + result.length * bytesPerSample, true); // file length - 8
    writeUTFBytes(view, 8, 'WAVE');
    // FMT sub-chunk
    writeUTFBytes(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size for PCM (16 bytes)
    view.setUint16(20, format, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // ByteRate
    view.setUint16(32, numChannels * bytesPerSample, true); // BlockAlign
    view.setUint16(34, bitDepth, true);
    // DATA sub-chunk
    writeUTFBytes(view, 36, 'data');
    view.setUint32(40, result.length * bytesPerSample, true); // Subchunk2Size (data size)

    // Write PCM samples
    let offset = 44;
    for (let i = 0; i < result.length; i++, offset += bytesPerSample) {
        let s = Math.max(-1, Math.min(1, result[i]));
        // Write 16-bit samples
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], {type: 'audio/wav'});
}

function interleave(inputL, inputR) {
    let length = inputL.length + inputR.length;
    let result = new Float32Array(length);
    let index = 0, inputIndex = 0;
    while (index < length) {
        result[index++] = inputL[inputIndex];
        result[index++] = inputR[inputIndex];
        inputIndex++;
    }
    return result;
}

function writeUTFBytes(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
// --- End WAV Encoding Functions ---

// --- 8D Effect Function ---
function apply8DEffect(inputBuffer) {
    return new Promise((resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            // Always output stereo for 8D effect
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);

            const audioSource = offlineCtx.createBufferSource();
            audioSource.buffer = inputBuffer;

            // Stereo Panner Node for left-right movement
            const stereoPanner = offlineCtx.createStereoPanner();

            // LFO to control the panning
            const lfoPan = offlineCtx.createOscillator();
            lfoPan.type = 'sine'; // Smooth oscillation
            lfoPan.frequency.value = 0.2; // Controls speed of panning (e.g., 0.2 Hz = 5 seconds per cycle)

            const lfoPanDepth = offlineCtx.createGain();
            lfoPanDepth.gain.value = 1.0; // Pan from -1 (hard left) to 1 (hard right)

            lfoPan.connect(lfoPanDepth);
            lfoPanDepth.connect(stereoPanner.pan); // Modulate the pan AudioParam

            // Connect audio path
            audioSource.connect(stereoPanner);
            stereoPanner.connect(offlineCtx.destination);

            // Start the LFO and the audio source
            lfoPan.start(0);
            audioSource.start(0);

            // Render the audio
            offlineCtx.startRendering()
                .then(renderedBuffer => {
                    resolve(renderedBuffer);
                })
                .catch(err => {
                    reject(new Error("8D effect rendering failed: " + err.message));
                });

        } catch (error) {
            reject(new Error("Error in apply8DEffect: " + error.message));
        }
    });
}
// --- End 8D Effect Function ---
