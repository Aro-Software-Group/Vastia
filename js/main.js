console.log("main.js loaded");

// --- Localization Globals ---
let currentLanguage = 'ja'; // Default language
let translations = {};

// Web Audio API Setup
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let currentSource = null;
let audioBuffer = null; // This will now store the processed buffer (or original if no processing)
let selectedFile = null; // To store the original selected file
let originalAudioBuffer = null; // To store the pristine decoded audio
let isProcessing = false; // To track if an audio transformation is in progress
let currentPlayerObjectUrl = null; // For managing the HTML5 player's Object URL

// Reverb IR
let reverbIrBuffer = null;
let irLoadingPromise = null; // To cache the promise during loading
let irLoadedSuccessfully = false;


// --- Localization Functions ---
async function loadTranslations(lang) {
    try {
        const response = await fetch(`locales/${lang}.json`);
        if (!response.ok) {
            console.error(`Could not load ${lang}.json. Status: ${response.status}`);
            return null; // Or load default 'ja' as fallback
        }
        translations = await response.json();
        return translations;
    } catch (error) {
        console.error(`Error loading translations for ${lang}:`, error);
        return null; // Or load default 'ja' as fallback
    }
}

function applyTranslations() {
    if (!translations) {
        console.warn("No translations loaded. Skipping application.");
        return;
    }
    document.querySelectorAll('[data-translate-key]').forEach(element => {
        const key = element.getAttribute('data-translate-key');
        const translation = translations[key];
        if (translation) {
            // Preserve child elements for elements like labels that might contain inputs
            if (element.children.length > 0 && (element.tagName === 'LABEL' || element.tagName === 'P')) {
                // Find the first text node and update it, or append if none
                let textNode = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
                if (textNode) {
                    textNode.textContent = translation;
                } else {
                    // This case might occur if a label's text is entirely within another element (e.g., a span)
                    // and that inner element is the one with the data-translate-key.
                    // If the key is on the outer element but text is inner, this simple update might not be ideal.
                    // However, for current structure, direct text content update is mostly fine.
                    // Fallback for complex structures or if no distinct text node found:
                    element.textContent = translation;
                }
            } else {
                element.textContent = translation;
            }
        } else {
            console.warn(`Translation not found for key: ${key}`);
        }
    });
    // Update dynamic text elements not covered by data-translate-key if any (e.g. title, though not requested yet)
    // document.title = translations['pageTitle'] || 'Vastia'; // Example if we add a pageTitle key
}

async function setLanguage(lang) {
    const loadedTranslations = await loadTranslations(lang);
    if (loadedTranslations) {
        currentLanguage = lang;
        document.documentElement.lang = lang;
        localStorage.setItem('userLanguage', lang);
        applyTranslations();
        // Special handling for dynamically generated messages after initial load
        // This might involve re-initializing certain UI text if it's set outside applyTranslations
        const fileNameElement = document.getElementById('fileName'); // Ensure it's defined in this scope or passed
        const statusMessageElement = document.getElementById('statusMessage'); // Ensure it's defined

        if (selectedFile && fileNameElement) {
             fileNameElement.textContent = getTranslation('fileSelected', selectedFile.name);
        } else if (fileNameElement) {
            fileNameElement.textContent = getTranslation('noFileSelected');
        }
        // Clear status message or set to a default if needed
        if (statusMessageElement) {
            statusMessageElement.textContent = ''; // Clear it or set to a default translated prompt
        }

    } else {
        console.error(`Failed to set language to ${lang} because translations could not be loaded.`);
        // Optionally, try to load the default language 'ja' as a fallback
        if (lang !== 'ja') {
            console.log("Attempting to load default language 'ja'.");
            await setLanguage('ja');
        }
    }
}

function getTranslation(key, ...args) {
    let translation = translations[key] || key; // Fallback to key if not found
    if (args.length > 0 && typeof translation === 'string') {
        args.forEach((arg, index) => {
            // Support {0}, {1}, ... and also {fileName} specifically for fileSelected
            const placeholder = new RegExp(`\\{${index}\\}|\\{fileName\\}`, 'g');
            translation = translation.replace(placeholder, arg);
        });
    }
    return translation;
}


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
                statusMessageElement.textContent = ''; // Clear previous messages, or use getTranslation('processingStatusClear')
                statusMessageElement.className = 'text-center my-3 font-medium'; // Reset class
            }
        } else {
            console.log("Audio processing finished.");
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
        }

        transformationRadios.forEach(radio => {
            radio.disabled = isProcessingActive || (!isProcessingActive && !originalAudioBuffer);
        });

        if (playButton) playButton.disabled = isProcessingActive || playButton.disabled;
        if (pauseButton) pauseButton.disabled = isProcessingActive || pauseButton.disabled;
        if (stopButton) stopButton.disabled = isProcessingActive || stopButton.disabled;
        if (downloadButton) downloadButton.disabled = isProcessingActive || downloadButton.disabled;

        if (!isProcessingActive) {
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
            selectedFile = event.target.files[0];

            if (currentSource) {
                currentSource.stop(0);
                currentSource.disconnect();
                currentSource = null;
            }
            audioContext.resume().then(() => {
                 if (audioContext.state === 'suspended') {
                    audioContext.resume();
                 }
            });

            if (selectedFile) {
                console.log("File selected:", selectedFile.name, selectedFile.type);
                if (fileNameElement) fileNameElement.textContent = getTranslation('fileSelected', selectedFile.name);
                if (statusMessageElement) {
                    statusMessageElement.textContent = '';
                    statusMessageElement.className = 'text-center my-3 font-medium';
                }
                transformationRadios.forEach(radio => radio.disabled = false);
                updateButtonStates(false, false, false, false);

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
                        originalAudioBuffer = buffer;
                        audioBuffer = originalAudioBuffer;
                        console.log('Audio decoded successfully.');
                        updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);

                        if (html5AudioPlayer && selectedFile) {
                            if (currentPlayerObjectUrl) {
                                URL.revokeObjectURL(currentPlayerObjectUrl);
                            }
                            currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
                            html5AudioPlayer.src = currentPlayerObjectUrl;
                        }
                    }, (error) => {
                        console.error('Error decoding audio data:', error);
                        originalAudioBuffer = null;
                        audioBuffer = null;
                        selectedFile = null;
                        updateButtonStates(false, false, false, false);
                        if (statusMessageElement) statusMessageElement.textContent = getTranslation('audioDecodeError', error.message);

                    });
                };
                reader.onerror = (error) => {
                    console.error('FileReader error:', error);
                    originalAudioBuffer = null;
                    audioBuffer = null;
                    selectedFile = null;
                    updateButtonStates(false, false, false, false);
                     if (statusMessageElement) statusMessageElement.textContent = getTranslation('fileReadError', error.message);
                };
                reader.readAsArrayBuffer(selectedFile);

            } else {
                console.log("No file selected.");
                if (fileNameElement) fileNameElement.textContent = getTranslation('noFileSelected');
                originalAudioBuffer = null;
                audioBuffer = null;
                selectedFile = null;
                transformationRadios.forEach(radio => radio.disabled = true);
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

    transformationRadios.forEach(radio => radio.disabled = true);

    if (audioContext.state === 'suspended') {
        console.log("AudioContext is suspended. Reverb IR will be loaded on first use or after context resumes.");
    }
    loadReverbIr(audioContext, 'assets/irs/default_reverb.wav').catch(error => {
        console.warn("Initial Reverb IR pre-loading failed. Will attempt again on first use.", error);
    });

    const playAudio = () => {
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed.');
                if (audioBuffer) {
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
        if (currentSource) {
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
            updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);
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

    const stopAudio = () => {
        if (currentSource) {
            currentSource.stop(0);
            console.log('Audio stopped.');
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                 updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);
            });
        } else {
            updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);
        }
    };

    if (playButton) playButton.addEventListener('click', playAudio);
    if (pauseButton) pauseButton.addEventListener('click', pauseAudio);
    if (stopButton) stopButton.addEventListener('click', stopAudio);

    updateButtonStates(false, false, false, false);

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
                    alert(getTranslation('downloadError', error.message));
                }
            } else if (isProcessing) {
                console.log("Cannot download while processing is active.");
                alert(getTranslation('downloadWaitForProcessing'));
            } else {
                console.log("No audio processed yet for download.");
                alert(getTranslation('downloadNoAudio'));
            }
        });
    }

    let selectedTransformation = '8d';

    if (transformationRadios.length > 0) {
        transformationRadios.forEach(radio => {
            if (radio.checked) {
                selectedTransformation = radio.value;
            }
            radio.addEventListener('change', (event) => {
                selectedTransformation = event.target.value;
                console.log("Selected transformation:", selectedTransformation);

                if (originalAudioBuffer && !isProcessing) {
                    if (audioContext.state === 'running' && currentSource) {
                        console.log("Stopping current audio before transformation.");
                        stopAudio();
                    }
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }

                    setProcessingState(true);

                    let effectPromise;
                    let effectDisplayName;

                    if (selectedTransformation === '8d') {
                        console.log(`Applying '8D Effect'...`);
                        effectPromise = apply8DEffect(originalAudioBuffer);
                        effectDisplayName = "8D Effect"; // This could be translated if needed: getTranslation('effectName8D')
                    } else if (selectedTransformation === '16d' || selectedTransformation === '32d') {
                        effectDisplayName = `${selectedTransformation}`; // getTranslation(`effectName${selectedTransformation}`)
                        console.log(`Applying placeholder '${effectDisplayName}'...`);
                        effectPromise = applyStereoWidening(originalAudioBuffer);
                    } else {
                        console.log(`No specific effect defined for '${selectedTransformation}'. Reverting to original.`);
                        audioBuffer = originalAudioBuffer;
                        if (statusMessageElement) {
                            statusMessageElement.textContent = getTranslation('noEffectApplied', selectedTransformation);
                            statusMessageElement.className = 'text-center my-3 font-medium text-gray-600';
                        }
                        if (html5AudioPlayer && selectedFile) {
                            if (currentPlayerObjectUrl) URL.revokeObjectURL(currentPlayerObjectUrl);
                            currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
                            html5AudioPlayer.src = currentPlayerObjectUrl;
                        }
                        setProcessingState(false);
                        effectPromise = null;
                    }

                    if (effectPromise) {
                        effectPromise.then(renderedBuffer => {
                            audioBuffer = renderedBuffer;
                            const successMsg = getTranslation('effectAppliedSuccess', effectDisplayName);
                            console.log(successMsg);
                            if (statusMessageElement) {
                                statusMessageElement.textContent = successMsg;
                                statusMessageElement.className = 'text-center my-3 font-medium text-green-600';
                            }
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
                            const errorMsg = getTranslation('effectAppliedError', effectDisplayName, error.message);
                            console.error(errorMsg);
                            if (statusMessageElement) {
                                statusMessageElement.textContent = errorMsg;
                                statusMessageElement.className = 'text-center my-3 font-medium text-red-600';
                            }
                            audioBuffer = originalAudioBuffer;
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
                    const previouslyCheckedRadio = document.querySelector(`input[name="transformation"][value="${selectedTransformation}"]`);
                    if (previouslyCheckedRadio) previouslyCheckedRadio.checked = true;
                }
            });
        });
        console.log("Initial transformation:", selectedTransformation);
    }

    // Language Switcher Logic
    const languageSwitcher = document.getElementById('language-switcher');
    if (languageSwitcher) {
        languageSwitcher.addEventListener('click', (event) => {
            const target = event.target;
            if (target.tagName === 'A' && target.dataset.lang) {
                event.preventDefault();
                const newLang = target.dataset.lang;
                if (newLang !== currentLanguage) {
                    setLanguage(newLang);
                }
            }
        });
    }

    // Initial language load
    const savedLanguage = localStorage.getItem('userLanguage');
    const browserLanguage = navigator.language.split('-')[0]; // Get 'en' from 'en-US'
    const supportedLanguages = ['ja', 'en', 'ko', 'zh', 'hi', 'es', 'fr'];
    const initialLang = savedLanguage || (supportedLanguages.includes(browserLanguage) ? browserLanguage : 'ja');
    setLanguage(initialLang);
});

// Transformation Function (Stereo Widening using Haas Effect)
function applyStereoWidening(inputBuffer) {
    return new Promise((resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = inputBuffer;
            const merger = offlineCtx.createChannelMerger(2);

            if (inputBuffer.numberOfChannels === 1) {
                const delayNode = offlineCtx.createDelay(0.1);
                delayNode.delayTime.value = 0.02;
                source.connect(merger, 0, 0);
                const gainNode = offlineCtx.createGain();
                source.connect(gainNode);
                gainNode.connect(delayNode);
                delayNode.connect(merger, 0, 1);
            } else {
                const splitter = offlineCtx.createChannelSplitter(2);
                source.connect(splitter);
                const rightChannelDelay = offlineCtx.createDelay(0.1);
                rightChannelDelay.delayTime.value = 0.02;
                splitter.connect(merger, 0, 0);
                splitter.connect(rightChannelDelay, 1);
                rightChannelDelay.connect(merger, 0, 1);
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
    writeUTFBytes(view, 0, 'RIFF');
    view.setUint32(4, 36 + result.length * bytesPerSample, true);
    writeUTFBytes(view, 8, 'WAVE');
    writeUTFBytes(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);
    writeUTFBytes(view, 36, 'data');
    view.setUint32(40, result.length * bytesPerSample, true);
    let offset = 44;
    for (let i = 0; i < result.length; i++, offset += bytesPerSample) {
        let s = Math.max(-1, Math.min(1, result[i]));
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
async function apply8DEffect(inputBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);
            let reverbSuccessfullyLoaded = false;
            try {
                reverbSuccessfullyLoaded = await loadReverbIr(offlineCtx, 'assets/irs/default_reverb.wav');
            } catch (error) {
                console.warn("Reverb IR loading failed or skipped, proceeding without reverb for 8D effect.", error);
            }
            const audioSource = offlineCtx.createBufferSource();
            audioSource.buffer = inputBuffer;
            const stereoPanner = offlineCtx.createStereoPanner();
            const lfoPan1 = offlineCtx.createOscillator();
            lfoPan1.type = 'sine';
            lfoPan1.frequency.value = 0.18;
            const lfoPanDepth1 = offlineCtx.createGain();
            lfoPanDepth1.gain.value = 0.8;
            lfoPan1.connect(lfoPanDepth1);
            lfoPanDepth1.connect(stereoPanner.pan);
            const lfoPan2 = offlineCtx.createOscillator();
            lfoPan2.type = 'sine';
            lfoPan2.frequency.value = 0.35;
            const lfoPanDepth2 = offlineCtx.createGain();
            lfoPanDepth2.gain.value = 0.2;
            lfoPan2.connect(lfoPanDepth2);
            lfoPanDepth2.connect(stereoPanner.pan);
            audioSource.connect(stereoPanner);
            let signalProcessingNode = stereoPanner;
            const filterNode = offlineCtx.createBiquadFilter();
            filterNode.type = 'lowpass';
            filterNode.frequency.value = 1000;
            filterNode.Q.value = 1;
            const lfoFilter = offlineCtx.createOscillator();
            lfoFilter.type = 'sine';
            lfoFilter.frequency.value = 0.15;
            const lfoFilterDepth = offlineCtx.createGain();
            lfoFilterDepth.gain.value = 800;
            lfoFilter.connect(lfoFilterDepth);
            lfoFilterDepth.connect(filterNode.frequency);
            signalProcessingNode.connect(filterNode);
            signalProcessingNode = filterNode;
            const directGain = offlineCtx.createGain();
            signalProcessingNode.connect(directGain);
            directGain.connect(offlineCtx.destination);
            const delayNode = offlineCtx.createDelay(5.0);
            delayNode.delayTime.value = 0.35;
            const feedbackGain = offlineCtx.createGain();
            feedbackGain.gain.value = 0.4;
            const delayWetGain = offlineCtx.createGain();
            signalProcessingNode.connect(delayNode);
            delayNode.connect(feedbackGain);
            feedbackGain.connect(delayNode);
            delayNode.connect(delayWetGain);
            delayWetGain.connect(offlineCtx.destination);

            if (reverbSuccessfullyLoaded && reverbIrBuffer) {
                const convolver = offlineCtx.createConvolver();
                convolver.buffer = reverbIrBuffer;
                convolver.normalize = true;
                const reverbWetGain = offlineCtx.createGain();
                signalProcessingNode.connect(convolver);
                convolver.connect(reverbWetGain);
                reverbWetGain.connect(offlineCtx.destination);
                directGain.gain.value = 0.5;
                delayWetGain.gain.value = 0.25;
                reverbWetGain.gain.value = 0.25;
                console.log("Gain staging: Direct=0.5, Delay=0.25, Reverb=0.25");
            } else {
                directGain.gain.value = 0.6;
                delayWetGain.gain.value = 0.4;
                console.log("Gain staging: Direct=0.6, Delay=0.4 (No Reverb)");
            }
            lfoPan1.start(0);
            lfoPan2.start(0);
            lfoFilter.start(0);
            audioSource.start(0);
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

// --- Reverb IR Loading Function ---
async function loadReverbIr(audioCtxForDecoding, irUrl = 'assets/irs/default_reverb.wav') {
    if (irLoadedSuccessfully && reverbIrBuffer) {
        console.log("Reverb IR already loaded.");
        return true;
    }
    if (irLoadingPromise) {
        console.log("Reverb IR loading is already in progress. Awaiting existing promise.");
        return irLoadingPromise;
    }
    console.log("Loading Reverb IR from:", irUrl);
    irLoadingPromise = new Promise(async (resolve, reject) => {
        try {
            const response = await fetch(irUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} while fetching ${irUrl}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            audioCtxForDecoding.decodeAudioData(arrayBuffer,
                (decodedBuffer) => {
                    reverbIrBuffer = decodedBuffer;
                    irLoadedSuccessfully = true;
                    console.log("Reverb IR loaded and decoded successfully.");
                    irLoadingPromise = null;
                    resolve(true);
                },
                (error) => {
                    console.error("Error decoding Reverb IR:", error);
                    irLoadedSuccessfully = false;
                    irLoadingPromise = null;
                    reject(error);
                }
            );
        } catch (error) {
            console.error("Failed to fetch Reverb IR:", error);
            irLoadedSuccessfully = false;
            irLoadingPromise = null;
            reject(error);
        }
    });
    return irLoadingPromise;
}
// --- End Reverb IR Loading Function ---
