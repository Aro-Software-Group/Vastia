const APP_VERSION = '1.0';
console.log(`main.js loaded - Vastia ${APP_VERSION}`);

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
let progressInterval = null; // Interval handle for progress updates

// Reverb IR
// let reverbIrBuffer = null;
// let irLoadingPromise = null;
// let irLoadedSuccessfully = false;
let irArrayBufferPromise = null;
let selectedTransformation = '8d'; // Default transformation

// Configuration Variables
// Stores default and current configurations for all audio effects.
// Each key is an effect type (e.g., '8d'), and its value is an object
// containing the parameters for that effect. These values are updated
// by the UI controls in the configuration panel.
let currentAudioConfig = {
    '8d': { panSpeed: 0.15, lfoPanDepth1: 0.7, lfoPanDepth2: 0.3, filterFreq: 1000, lfoFilterSpeed: 0.15, reverbMix: 0.25, delayMix: 0.25 },
    '16d': { pannerXOscRate: 0.05, pannerXOscWidth: 5, reverbMix: 0.4, pannerZPos: -5 },
    '32d': { panXRate: 0.1, panXWidth: 3, panYRate: 0.07, panYWidth: 2, panZRate: 0.05, panZWidth: 4, reverbMix: 0.5 },
    '64d': { panXRate: 0.15, panXWidth: 6, panYRate: 0.1, panYWidth: 4, panZRate: 0.08, panZWidth: 6, reverbMix: 0.6 },
    'stereo': {},
    'reverse': {},
    'bassboost': { gain: 6 },
    'echo': { delayTime: 0.3, feedback: 0.4 },
    'pitchup': { factor: 1.25 },
    'pitchdown': { factor: 0.8 },
    'speedup': { factor: 1.25 },
    'slowdown': { factor: 0.8 },
    'reverb': { mix: 0.5 }
    ,'hq': { oversample: 0 }
};
// UI elements for the configuration panel
let toggleConfigButton, configPanel, configOptionsContainer, applyConfigButton;

// UI Elements that are widely used and initialized in DOMContentLoaded
let fileUploadSection = null; // Added for drag and drop
let fileNameElement = null;
let statusMessageElement = null;
let html5AudioPlayer = null;
// playButton, pauseButton, stopButton, downloadButton, loadingIndicator, transformationRadios
// will be fetched internally by updateButtonStates and setProcessingState.

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
        // Use globally assigned elements for dynamic text updates
        fileNameElement = document.getElementById('fileName');
        statusMessageElement = document.getElementById('statusMessage');

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

// Placed near the top of the script (global scope)
const updateButtonStates = (isPlaying = false, isPaused = false, canPlay = false, canDownload = false) => {
    const playBtn = document.getElementById('playButton');
    const pauseBtn = document.getElementById('pauseButton');
    const stopBtn = document.getElementById('stopButton');
    const downloadBtn = document.getElementById('downloadButton');

    if (playBtn) playBtn.disabled = isPlaying || !canPlay;
    if (pauseBtn) pauseBtn.disabled = (!isPlaying || isPaused) || !canPlay;
    if (stopBtn) stopBtn.disabled = (!isPlaying && !isPaused) || !canPlay;
    if (downloadBtn) downloadBtn.disabled = !canDownload;
};

// Placed in global scope, after updateButtonStates
const setProcessingState = (isProcessingActive) => {
    isProcessing = isProcessingActive; // isProcessing is already global

    const loadingIndicatorElem = document.getElementById('loadingIndicator');
    const statusMessageElem = document.getElementById('statusMessage');
    const radios = document.querySelectorAll('input[name="transformation"]');

    if (isProcessingActive) {
        console.log("Audio processing started...");
        if (loadingIndicatorElem) loadingIndicatorElem.classList.remove('hidden');
        const progressElem = document.getElementById('progressPercent');
        if (progressElem) progressElem.textContent = '0%';
        if (statusMessageElem) {
            statusMessageElem.textContent = '';
            statusMessageElem.className = 'text-center my-3 font-medium';
        }
    } else {
        console.log("Audio processing finished.");
        if (loadingIndicatorElem) loadingIndicatorElem.classList.add('hidden');
        stopProgressMonitoring('100%');
    }

    if (radios) {
        radios.forEach(radio => {
            // originalAudioBuffer is global
            radio.disabled = isProcessingActive || (!isProcessingActive && !originalAudioBuffer);
        });
    }

    const playBtn = document.getElementById('playButton');
    const pauseBtn = document.getElementById('pauseButton');
    const stopBtn = document.getElementById('stopButton');
    const downloadBtn = document.getElementById('downloadButton');

    if (playBtn) playBtn.disabled = isProcessingActive || (originalAudioBuffer ? playBtn.disabled : true);
    if (pauseBtn) pauseBtn.disabled = isProcessingActive || (originalAudioBuffer ? pauseBtn.disabled : true);
    if (stopBtn) stopBtn.disabled = isProcessingActive || (originalAudioBuffer ? stopBtn.disabled : true);
    if (downloadBtn) downloadBtn.disabled = isProcessingActive || (originalAudioBuffer ? downloadBtn.disabled : true);

    if (!isProcessingActive) {
         // audioContext, currentSource, audioBuffer are global.
        updateButtonStates(audioContext.state === 'running' && currentSource, audioContext.state === 'suspended', !!audioBuffer, !!audioBuffer);
    }
};

// --- Progress Monitoring Functions ---
function startProgressMonitoring(ctx, duration) {
    const progressElem = document.getElementById('progressPercent');
    if (progressElem) progressElem.textContent = '0%';
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        const progress = Math.min(ctx.currentTime / duration, 1);
        if (progressElem) progressElem.textContent = Math.floor(progress * 100) + '%';
        if (progress >= 1) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }, 100);
}

function stopProgressMonitoring(finalValue = '100%') {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    const progressElem = document.getElementById('progressPercent');
    if (progressElem) progressElem.textContent = finalValue;
}

function renderWithProgress(offlineCtx) {
    const duration = offlineCtx.length / offlineCtx.sampleRate;
    startProgressMonitoring(offlineCtx, duration);
    return offlineCtx.startRendering().then(buffer => {
        stopProgressMonitoring('100%');
        return buffer;
    }).catch(err => {
        stopProgressMonitoring('0%');
        throw err;
    });
}

// File Upload Logic
document.addEventListener('DOMContentLoaded', () => {
    const fileUploadElement = document.getElementById('fileUpload'); // Can remain local if only used here

    // Assign to global variables (those that are still global)
    fileUploadSection = document.getElementById('file-upload'); // Added for drag and drop
    html5AudioPlayer = document.getElementById('html5AudioPlayer');
    fileNameElement = document.getElementById('fileName');
    statusMessageElement = document.getElementById('statusMessage');

    // Config panel UI elements (already global, but ensure they are assigned here)
    toggleConfigButton = document.getElementById('toggleConfigButton');
    configPanel = document.getElementById('configPanel');
    configOptionsContainer = document.getElementById('configOptionsContainer');
    applyConfigButton = document.getElementById('applyConfigButton');

    // Initialize event listeners for buttons that are now fetched internally by the functions
    const playBtn = document.getElementById('playButton');
    const pauseBtn = document.getElementById('pauseButton');
    const stopBtn = document.getElementById('stopButton');
    const downloadBtn = document.getElementById('downloadButton');

    // The definitions of setProcessingState and updateButtonStates are now global.

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
                // Enable radios - setProcessingState will handle disabling during processing
                const localTransformationRadios = document.querySelectorAll('input[name="transformation"]');
                if (localTransformationRadios) {
                    localTransformationRadios.forEach(radio => radio.disabled = false);
                }
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
                const localTransformationRadios = document.querySelectorAll('input[name="transformation"]');
                if (localTransformationRadios) {
                    localTransformationRadios.forEach(radio => radio.disabled = true);
                }
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

    // Drag and Drop Event Listeners
    if (fileUploadSection) {
        fileUploadSection.addEventListener('dragenter', (event) => {
            event.preventDefault();
            fileUploadSection.classList.add('c-file-upload-area--dragover');
        });

        fileUploadSection.addEventListener('dragover', (event) => {
            event.preventDefault(); // Necessary to allow dropping
            fileUploadSection.classList.add('c-file-upload-area--dragover');
        });

        fileUploadSection.addEventListener('dragleave', (event) => {
            fileUploadSection.classList.remove('c-file-upload-area--dragover');
        });

        fileUploadSection.addEventListener('drop', (event) => {
            event.preventDefault();
            fileUploadSection.classList.remove('c-file-upload-area--dragover');
            handleFileDrop(event);
        });
    }

    // Disable transformation radios initially
    const initialTransformationRadios = document.querySelectorAll('input[name="transformation"]');
    if (initialTransformationRadios) {
        initialTransformationRadios.forEach(radio => radio.disabled = true);
    }

    if (audioContext.state === 'suspended') {
        console.log("AudioContext is suspended. Reverb IR will be loaded on first use or after context resumes.");
    }
    getReverbIrArrayBuffer('assets/irs/default_reverb.wav').catch(error => { // Changed loadReverbIr to getReverbIrArrayBuffer
        console.warn("Initial Reverb IR ArrayBuffer pre-fetching failed. Will attempt again on first use.", error);
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
            // Stop and fully release the existing AudioBufferSourceNode to
            // avoid calling stop() on an already-stopped node the next time
            // playback starts.
            currentSource.stop(0);
            currentSource.disconnect();
            currentSource = null;
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

    if (playBtn) playBtn.addEventListener('click', playAudio);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseAudio);
    if (stopBtn) stopBtn.addEventListener('click', stopAudio);

    updateButtonStates(false, false, false, false); // Initial state

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
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

    // Setup transformation radio change listeners
    const localTransformationRadios = document.querySelectorAll('input[name="transformation"]');
    if (localTransformationRadios.length > 0) {
        localTransformationRadios.forEach(radio => {
            if (radio.checked) {
                selectedTransformation = radio.value;
            }
            radio.addEventListener('change', (event) => {
                selectedTransformation = event.target.value;
                console.log("Selected transformation:", selectedTransformation);
                if (configPanel && !configPanel.classList.contains('hidden')) {
                    populateConfigOptions(selectedTransformation);
                }
                triggerAudioProcessing();
            });
        });
        console.log("Initial transformation:", selectedTransformation);
    }


    // Config Panel Toggle Logic
    // Handles showing and hiding the configuration panel.
    // When shown, it populates the panel with options for the currently selected effect.
    if (toggleConfigButton && configPanel) {
        toggleConfigButton.addEventListener('click', () => {
            configPanel.classList.toggle('hidden');
            const isHidden = configPanel.classList.contains('hidden');
            // Update button text based on panel visibility using translation keys
            toggleConfigButton.textContent = getTranslation(isHidden ? 'showConfiguration' : 'hideConfiguration');
            if (!isHidden) {
                populateConfigOptions(selectedTransformation); // Populate/refresh options when panel is shown
            }
        });
    }

    // Apply Config Button Listener
    // When clicked, re-applies the currently selected audio effect using the latest
    // configuration values from `currentAudioConfig`.
    if (applyConfigButton) {
        applyConfigButton.addEventListener('click', () => {
            if (originalAudioBuffer && selectedTransformation) {
                console.log("Apply config button clicked for:", selectedTransformation, "with config:", currentAudioConfig[selectedTransformation]);
                triggerAudioProcessing(); // Central function to handle effect application
            }
        });
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

// --- Drag and Drop File Handling ---
function handleFileDrop(event) {
    event.preventDefault(); // Should have been called by 'drop' listener, but good practice
    event.stopPropagation(); // Stop bubbling

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        selectedFile = files[0]; // Assign to global selectedFile

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

        console.log("File dropped:", selectedFile.name, selectedFile.type);
        if (fileNameElement) fileNameElement.textContent = getTranslation('fileSelected', selectedFile.name);
        if (statusMessageElement) {
            statusMessageElement.textContent = '';
            statusMessageElement.className = 'text-center my-3 font-medium';
        }

        // Enable radios - setProcessingState will handle disabling during processing
        const localTransformationRadios = document.querySelectorAll('input[name="transformation"]');
        if (localTransformationRadios) {
            localTransformationRadios.forEach(radio => radio.disabled = false);
        }
        updateButtonStates(false, false, false, false); // Reset button states

        if (html5AudioPlayer) {
            if (currentPlayerObjectUrl) {
                URL.revokeObjectURL(currentPlayerObjectUrl);
                currentPlayerObjectUrl = null;
            }
            html5AudioPlayer.src = ''; // Clear previous source
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            audioContext.decodeAudioData(e.target.result, (buffer) => {
                originalAudioBuffer = buffer;
                audioBuffer = originalAudioBuffer; // Initially, processed buffer is the original
                console.log('Audio (from drop) decoded successfully.');
                updateButtonStates(false, false, !!audioBuffer, !!audioBuffer);

                if (html5AudioPlayer && selectedFile) {
                    if (currentPlayerObjectUrl) {
                        URL.revokeObjectURL(currentPlayerObjectUrl);
                    }
                    currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
                    html5AudioPlayer.src = currentPlayerObjectUrl;
                }
                // If a transformation is already selected, trigger processing
                // This matches behavior of file input if a transformation was pre-selected
                if (selectedTransformation && originalAudioBuffer) {
                    triggerAudioProcessing();
                }
            }, (error) => {
                console.error('Error decoding audio data (from drop):', error);
                originalAudioBuffer = null;
                audioBuffer = null;
                selectedFile = null;
                updateButtonStates(false, false, false, false);
                if (statusMessageElement) statusMessageElement.textContent = getTranslation('audioDecodeError', error.message);
            });
        };
        reader.onerror = (error) => {
            console.error('FileReader error (from drop):', error);
            originalAudioBuffer = null;
            audioBuffer = null;
            selectedFile = null;
            updateButtonStates(false, false, false, false);
            if (statusMessageElement) statusMessageElement.textContent = getTranslation('fileReadError', error.message);
        };
        reader.readAsArrayBuffer(selectedFile);
    } else {
        console.log("No file dropped or drop contained no files.");
    }
}
// --- End Drag and Drop File Handling ---

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
            renderWithProgress(offlineCtx).then(renderedBuffer => {
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

/**
 * Dynamically populates the configuration panel with options for the given effect type.
 * It clears previous options and builds new UI elements (sliders) based on the
 * parameters defined in `currentAudioConfig` for the specified `effectType`.
 * Event listeners are attached to these sliders to update `currentAudioConfig` in real-time.
 * @param {string} effectType - The type of audio effect (e.g., '8d', '16d', '32d').
 */
function populateConfigOptions(effectType) {
    if (!configOptionsContainer) return;
    configOptionsContainer.innerHTML = ''; // Clear previous options before adding new ones

    const config = currentAudioConfig[effectType]; // Get current configuration for the effect
    // Set a title for the configuration section, using translation if available
    let optionsHtml = `<h4 class="text-md font-semibold mb-2">${getTranslation(effectType + 'ConfigTitle', effectType + " Settings")}</h4>`;

    if (!config) {
        // Display a message if no configuration is defined for the effect type
        optionsHtml += `<p>${getTranslation('noConfigYet', "Configuration options for this effect are not yet available.")}</p>`;
        configOptionsContainer.innerHTML = optionsHtml;
        return;
    }

    // Generate HTML for sliders based on the effect type
    if (effectType === '8d') {
        optionsHtml += `
            <div class="space-y-1">
                <label for="8dPanSpeed" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panSpeed8D', 'Panning Speed:')}</label>
                <input type="range" id="8dPanSpeed" min="0.01" max="0.5" step="0.01" value="${config.panSpeed}" class="config-slider">
                <span id="8dPanSpeedValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panSpeed} Hz</span>
            </div>
            <div class="space-y-1">
                <label for="8dLfoPanDepth1" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('lfoPanDepth1_8D', 'LFO 1 Depth:')}</label>
                <input type="range" id="8dLfoPanDepth1" min="0.1" max="1.0" step="0.05" value="${config.lfoPanDepth1}" class="config-slider">
                <span id="8dLfoPanDepth1Value" class="text-xs text-[var(--win-text-tertiary)]">${config.lfoPanDepth1}</span>
            </div>
            <div class="space-y-1">
                <label for="8dLfoPanDepth2" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('lfoPanDepth2_8D', 'LFO 2 Depth:')}</label>
                <input type="range" id="8dLfoPanDepth2" min="0.1" max="1.0" step="0.05" value="${config.lfoPanDepth2}" class="config-slider">
                <span id="8dLfoPanDepth2Value" class="text-xs text-[var(--win-text-tertiary)]">${config.lfoPanDepth2}</span>
            </div>
            <div class="space-y-1">
                <label for="8dFilterFreq" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('filterFreq8D', 'Filter Base Freq:')}</label>
                <input type="range" id="8dFilterFreq" min="200" max="2000" step="50" value="${config.filterFreq}" class="config-slider">
                <span id="8dFilterFreqValue" class="text-xs text-[var(--win-text-tertiary)]">${config.filterFreq} Hz</span>
            </div>
            <div class="space-y-1">
                <label for="8dlfoFilterSpeed" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('lfoFilterSpeed8D', 'Filter LFO Speed:')}</label>
                <input type="range" id="8dlfoFilterSpeed" min="0.01" max="0.5" step="0.01" value="${config.lfoFilterSpeed}" class="config-slider">
                <span id="8dlfoFilterSpeedValue" class="text-xs text-[var(--win-text-tertiary)]">${config.lfoFilterSpeed} Hz</span>
            </div>
            <div class="space-y-1">
                <label for="8dReverbMix" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('reverbMix8D', 'Reverb Mix:')}</label>
                <input type="range" id="8dReverbMix" min="0" max="1" step="0.05" value="${config.reverbMix}" class="config-slider">
                <span id="8dReverbMixValue" class="text-xs text-[var(--win-text-tertiary)]">${config.reverbMix}</span>
            </div>
            <div class="space-y-1">
                <label for="8dDelayMix" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('delayMix8D', 'Delay Mix:')}</label>
                <input type="range" id="8dDelayMix" min="0" max="1" step="0.05" value="${config.delayMix}" class="config-slider">
                <span id="8dDelayMixValue" class="text-xs text-[var(--win-text-tertiary)]">${config.delayMix}</span>
            </div>
        `;
    } else if (effectType === '16d') {
        optionsHtml += `
            <div class="space-y-1"><label for="16dOscRate" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('oscRate16D', 'X-Axis Osc. Rate:')}</label><input type="range" id="16dOscRate" min="0.01" max="0.2" step="0.01" value="${config.pannerXOscRate}" class="config-slider"><span id="16dOscRateValue" class="text-xs text-[var(--win-text-tertiary)]">${config.pannerXOscRate} Hz</span></div>
            <div class="space-y-1"><label for="16dOscWidth" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('oscWidth16D', 'X-Axis Osc. Width:')}</label><input type="range" id="16dOscWidth" min="1" max="10" step="0.5" value="${config.pannerXOscWidth}" class="config-slider"><span id="16dOscWidthValue" class="text-xs text-[var(--win-text-tertiary)]">${config.pannerXOscWidth}</span></div>
            <div class="space-y-1"><label for="16dZPos" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('zPos16D', 'Z Position:')}</label><input type="range" id="16dZPos" min="-10" max="0" step="0.5" value="${config.pannerZPos}" class="config-slider"><span id="16dZPosValue" class="text-xs text-[var(--win-text-tertiary)]">${config.pannerZPos}</span></div>
            <div class="space-y-1"><label for="16dReverbMix" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('reverbMix16D', 'Reverb Mix:')}</label><input type="range" id="16dReverbMix" min="0" max="1" step="0.05" value="${config.reverbMix}" class="config-slider"><span id="16dReverbMixValue" class="text-xs text-[var(--win-text-tertiary)]">${config.reverbMix}</span></div>
        `;
    } else if (effectType === '32d') {
        optionsHtml += `
            <div class="space-y-1"><label for="32dPanXRate" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panXRate32D', 'X-Rate:')}</label><input type="range" id="32dPanXRate" min="0.01" max="0.5" step="0.01" value="${config.panXRate}" class="config-slider"><span id="32dPanXRateValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panXRate} Hz</span></div>
            <div class="space-y-1"><label for="32dPanXWidth" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panXWidth32D', 'X-Width:')}</label><input type="range" id="32dPanXWidth" min="0" max="10" step="0.5" value="${config.panXWidth}" class="config-slider"><span id="32dPanXWidthValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panXWidth}</span></div>
            <div class="space-y-1"><label for="32dPanYRate" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panYRate32D', 'Y-Rate:')}</label><input type="range" id="32dPanYRate" min="0.01" max="0.5" step="0.01" value="${config.panYRate}" class="config-slider"><span id="32dPanYRateValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panYRate} Hz</span></div>
            <div class="space-y-1"><label for="32dPanYWidth" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panYWidth32D', 'Y-Width:')}</label><input type="range" id="32dPanYWidth" min="0" max="10" step="0.5" value="${config.panYWidth}" class="config-slider"><span id="32dPanYWidthValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panYWidth}</span></div>
            <div class="space-y-1"><label for="32dPanZRate" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panZRate32D', 'Z-Rate:')}</label><input type="range" id="32dPanZRate" min="0.01" max="0.5" step="0.01" value="${config.panZRate}" class="config-slider"><span id="32dPanZRateValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panZRate} Hz</span></div>
            <div class="space-y-1"><label for="32dPanZWidth" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('panZWidth32D', 'Z-Width:')}</label><input type="range" id="32dPanZWidth" min="0" max="10" step="0.5" value="${config.panZWidth}" class="config-slider"><span id="32dPanZWidthValue" class="text-xs text-[var(--win-text-tertiary)]">${config.panZWidth}</span></div>
            <div class="space-y-1"><label for="32dReverbMix" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('reverbMix32D', 'Reverb Mix:')}</label><input type="range" id="32dReverbMix" min="0" max="1" step="0.05" value="${config.reverbMix}" class="config-slider"><span id="32dReverbMixValue" class="text-xs text-[var(--win-text-tertiary)]">${config.reverbMix}</span></div>
        `;
    } else if (effectType === 'hq') {
        optionsHtml += `
            <div class="space-y-1"><label for="hqOversample" class="block text-sm font-medium text-[var(--win-text-secondary)]">${getTranslation('hqOversample', 'Oversample (0=Auto):')}</label><input type="range" id="hqOversample" min="0" max="4" step="1" value="${config.oversample}" class="config-slider"><span id="hqOversampleValue" class="text-xs text-[var(--win-text-tertiary)]">${config.oversample === 0 ? getTranslation('autoLabel', 'Auto') : config.oversample}</span></div>
        `;
    }
    configOptionsContainer.innerHTML = optionsHtml;
    document.querySelectorAll('.config-slider').forEach(slider => {
        const displayId = slider.id + 'Value';
        const valueDisplay = document.getElementById(displayId);

        let effectKey;
        let rawConfigKey; // Not directly used for formattedConfigKey in the final logic, but good for clarity

        if (slider.id.startsWith('8d')) {
            effectKey = '8d';
            rawConfigKey = slider.id.substring(2); // Remove "8d" prefix
        } else if (slider.id.startsWith('16d')) {
            effectKey = '16d';
            rawConfigKey = slider.id.substring(3); // Remove "16d" prefix
        } else if (slider.id.startsWith('32d')) {
            effectKey = '32d';
            rawConfigKey = slider.id.substring(3); // Remove "32d" prefix
        } else if (slider.id.startsWith('hq')) {
            effectKey = 'hq';
            rawConfigKey = slider.id.substring(2);
        } else {
            console.error('Could not determine effectKey for slider ID:', slider.id);
            return; // Skip this slider if effectKey is unknown
        }

        let formattedConfigKey;

        // Refined formattedConfigKey logic based on original explicit mappings
        if (effectKey === '8d') {
            if (slider.id.includes('PanSpeed')) formattedConfigKey = 'panSpeed';
            else if (slider.id.includes('LfoPanDepth1')) formattedConfigKey = 'lfoPanDepth1';
            else if (slider.id.includes('LfoPanDepth2')) formattedConfigKey = 'lfoPanDepth2';
            else if (slider.id.includes('FilterFreq')) formattedConfigKey = 'filterFreq';
            else if (slider.id.includes('lfoFilterSpeed')) formattedConfigKey = 'lfoFilterSpeed';
            else if (slider.id.includes('ReverbMix')) formattedConfigKey = 'reverbMix';
            else if (slider.id.includes('DelayMix')) formattedConfigKey = 'delayMix';
        } else if (effectKey === '16d') {
            if (slider.id.includes('OscRate')) formattedConfigKey = 'pannerXOscRate';
            else if (slider.id.includes('OscWidth')) formattedConfigKey = 'pannerXOscWidth';
            else if (slider.id.includes('ZPos')) formattedConfigKey = 'pannerZPos';
            else if (slider.id.includes('ReverbMix')) formattedConfigKey = 'reverbMix';
        } else if (effectKey === '32d') {
            if (slider.id.includes('PanXRate')) formattedConfigKey = 'panXRate';
            else if (slider.id.includes('PanXWidth')) formattedConfigKey = 'panXWidth';
            else if (slider.id.includes('PanYRate')) formattedConfigKey = 'panYRate';
            else if (slider.id.includes('PanYWidth')) formattedConfigKey = 'panYWidth';
            else if (slider.id.includes('PanZRate')) formattedConfigKey = 'panZRate';
            else if (slider.id.includes('PanZWidth')) formattedConfigKey = 'panZWidth';
            else if (slider.id.includes('ReverbMix')) formattedConfigKey = 'reverbMix';
        } else if (effectKey === 'hq') {
            if (slider.id.includes('Oversample')) formattedConfigKey = 'oversample';
        }

        // Ensure formattedConfigKey was actually found/set by the conditions above.
        if (!formattedConfigKey) {
            console.error(`Could not determine formattedConfigKey for slider ID: ${slider.id} within effectKey: ${effectKey}`);
            return; // Skip if no specific mapping was found.
        }

        const updateDisplay = (val) => {
            const unit = (slider.id.toLowerCase().includes('rate') || slider.id.toLowerCase().includes('speed') || slider.id.toLowerCase().includes('freq')) ? ' Hz' : '';
            if (slider.id === 'hqOversample' && val === 0) {
                valueDisplay.textContent = getTranslation('autoLabel', 'Auto');
            } else {
                valueDisplay.textContent = val + unit;
            }
        };

        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            updateDisplay(value);
            if (currentAudioConfig[effectKey]) {
                currentAudioConfig[effectKey][formattedConfigKey] = value;
                console.log(`[populateConfigOptions] Updated currentAudioConfig['${effectKey}'].${formattedConfigKey} to: ${value}`);
            } else {
                console.error(`[populateConfigOptions] effectKey '${effectKey}' not found in currentAudioConfig.`);
            }
        });

        // Initialize display
        updateDisplay(parseFloat(slider.value));
    });
}

/**
 * Central function to initiate the audio processing for the selected effect.
 * - Handles stopping any currently playing audio.
 * - Manages the AudioContext state (resumes if suspended).
 * - Sets a processing state flag to disable UI elements during processing.
 * - Retrieves the current configuration for the selected effect.
 * - Calls the appropriate effect function (apply8DEffect, apply16DEffect, etc.).
 * - Handles the promise returned by the effect function to update UI (status messages, player).
 */
function triggerAudioProcessing() {
    // Don't proceed if no audio buffer is loaded or if processing is already active
    if (!originalAudioBuffer || isProcessing) {
        if (isProcessing) console.log("Processing already in progress. New request ignored.");
        return;
    }

    // Stop any audio that might be currently playing
    if (audioContext.state === 'running' && currentSource) {
        console.log("Stopping current audio before new transformation.");
        stopAudio();
    }
    // Resume AudioContext if it's suspended (e.g., after inactivity or page load)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    setProcessingState(true); // Indicate that processing has started, disable relevant UI
    let effectPromise;
    let effectDisplayName;
    // Get the configuration for the currently selected transformation
    const effectConfig = currentAudioConfig[selectedTransformation];
    console.log(`[triggerAudioProcessing] Selected Transformation: ${selectedTransformation}`);
    console.log(`[triggerAudioProcessing] Effect Configuration to be applied:`, effectConfig);

    // Call the appropriate effect function based on the selected transformation
    if (selectedTransformation === '8d') {
        effectPromise = apply8DEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectName8D', "8D Effect");
    } else if (selectedTransformation === '16d') {
        effectPromise = apply16DEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectName16D', "16D Effect");
    } else if (selectedTransformation === '32d') {
        effectPromise = apply32DEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectName32D', "32D Effect");
    } else if (selectedTransformation === '64d') {
        effectPromise = apply64DEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectName64D', "64D Effect");
    } else if (selectedTransformation === 'stereo') {
        effectPromise = applyStereoWidening(originalAudioBuffer);
        effectDisplayName = getTranslation('effectNameStereo', "Stereo Widen");
    } else if (selectedTransformation === 'reverse') {
        effectPromise = applyReverseEffect(originalAudioBuffer);
        effectDisplayName = getTranslation('effectNameReverse', "Reverse");
    } else if (selectedTransformation === 'bassboost') {
        effectPromise = applyBassBoostEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectNameBassBoost', "Bass Boost");
    } else if (selectedTransformation === 'echo') {
        effectPromise = applyEchoEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectNameEcho', "Echo");
    } else if (selectedTransformation === 'pitchup') {
        effectPromise = applyPitchShiftEffect(originalAudioBuffer, effectConfig.factor || 1.25);
        effectDisplayName = getTranslation('effectNamePitchUp', "Pitch Up");
    } else if (selectedTransformation === 'pitchdown') {
        effectPromise = applyPitchShiftEffect(originalAudioBuffer, effectConfig.factor || 0.8);
        effectDisplayName = getTranslation('effectNamePitchDown', "Pitch Down");
    } else if (selectedTransformation === 'speedup') {
        effectPromise = applySpeedChangeEffect(originalAudioBuffer, effectConfig.factor || 1.25);
        effectDisplayName = getTranslation('effectNameSpeedUp', "Speed Up");
    } else if (selectedTransformation === 'slowdown') {
        effectPromise = applySpeedChangeEffect(originalAudioBuffer, effectConfig.factor || 0.8);
        effectDisplayName = getTranslation('effectNameSlowDown', "Slow Down");
    } else if (selectedTransformation === 'hq') {
        effectPromise = applyHQEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectNameHQ', "Quality Boost");
    } else if (selectedTransformation === 'reverb') {
        effectPromise = applyReverbOnlyEffect(originalAudioBuffer, effectConfig);
        effectDisplayName = getTranslation('effectNameReverb', "Reverb Only");
    } else {
        console.log(`No specific effect defined for '${selectedTransformation}'. Reverting to original.`);
        audioBuffer = originalAudioBuffer;
        if (statusMessageElement) {
            statusMessageElement.textContent = getTranslation('noEffectApplied', selectedTransformation);
            statusMessageElement.className = 'text-center my-3 font-medium text-gray-600'; // Consider var for color
        }
        if (html5AudioPlayer && selectedFile) {
            if (currentPlayerObjectUrl) URL.revokeObjectURL(currentPlayerObjectUrl);
            currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
            html5AudioPlayer.src = currentPlayerObjectUrl;
        }
        setProcessingState(false);
        return; // No promise to handle
    }

    if (effectPromise) {
        console.log(`[triggerAudioProcessing] Effect promise created for ${effectDisplayName}. Waiting for render...`);
        effectPromise.then(renderedBuffer => {
            audioBuffer = renderedBuffer;
            const successMsg = getTranslation('effectAppliedSuccess', effectDisplayName);
            console.log(`[triggerAudioProcessing] Effect ${effectDisplayName} applied successfully. Message: ${successMsg}`);
            if (statusMessageElement) {
                statusMessageElement.textContent = successMsg;
                statusMessageElement.className = 'text-center my-3 font-medium text-green-600'; // Consider var for color
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
            console.error(`[triggerAudioProcessing] Error applying effect ${effectDisplayName}:`, error.message);
            if (statusMessageElement) {
                statusMessageElement.textContent = errorMsg;
                statusMessageElement.className = 'text-center my-3 font-medium text-red-600'; // Consider var for color
            }
            audioBuffer = originalAudioBuffer; // Revert to original on error
            if (html5AudioPlayer && selectedFile) {
                if (currentPlayerObjectUrl) URL.revokeObjectURL(currentPlayerObjectUrl);
                currentPlayerObjectUrl = URL.createObjectURL(selectedFile);
                html5AudioPlayer.src = currentPlayerObjectUrl;
                console.log("HTML5 player reverted to original audio due to processing error.");
            }
        })
        .finally(() => {
            setProcessingState(false);
            // Refresh config options if panel is open, as processing might have taken time
            // and user might have changed radio button for a different effect type
            if (configPanel && !configPanel.classList.contains('hidden')) {
                 populateConfigOptions(selectedTransformation);
            }
        });
    }
}


// --- 8D Effect Function ---
/**
 * Applies an 8D audio effect to the input buffer.
 * Features:
 * - Dual LFOs for stereo panning: Creates a circular rotation effect.
 *   - `lfoPan1` and `lfoPan2` oscillate at slightly different frequencies and depths
 *     (controlled by `config.panSpeed`, `config.lfoPanDepth1`, `config.lfoPanDepth2`)
 *     to make the panning feel more complex.
 * - Low-pass filter with LFO: Adds a sweeping filter effect.
 *   - `filterNode` is a BiquadFilter (lowpass).
 *   - `lfoFilter` modulates the filter's cutoff frequency (controlled by `config.lfoFilterSpeed`).
 *   - `config.filterFreq` sets the base cutoff frequency of the filter.
 * - Delay effect: Adds spaciousness.
 * - Reverb effect: Adds further spaciousness using a convolution reverb.
 * - Configurable parameters:
 *   - `panSpeed`: Base speed of the main panning LFOs.
 *   - `lfoPanDepth1`, `lfoPanDepth2`: Depth of the two panning LFOs.
 *   - `filterFreq`: Base cutoff frequency for the lowpass filter.
 *   - `lfoFilterSpeed`: Speed of the LFO modulating the filter's frequency.
 *   - `reverbMix`: Wet/dry mix for the reverb effect.
 *   - `delayMix`: Wet/dry mix for the delay effect.
 * - Gain Staging:
 *   - The final output is a mix of direct (filtered), delay, and reverb signals.
 *   - `config.reverbMix` controls the reverb amount.
 *   - `config.delayMix` controls the delay amount.
 *   - The direct signal proportion is `1 - reverbMix - delayMix`.
 *   - If reverb is not loaded, its intended mix portion is redistributed proportionally
 *     between the direct and delay signals to maintain overall loudness.
 * @param {AudioBuffer} inputBuffer - The original audio data.
 * @param {object} userConfig - User-defined configuration for the effect.
 * @returns {Promise<AudioBuffer>} A promise that resolves with the processed audio buffer.
 */
async function apply8DEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['8d'], ...userConfig }; // Merge user config with defaults
    console.log("[apply8DEffect] Received userConfig:", userConfig);
    console.log("[apply8DEffect] Applying 8D effect with final merged config:", config);

    return new Promise(async (resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);

            let decodedReverbIrBuffer = null;
            try {
                const irArrayBuffer = await getReverbIrArrayBuffer('assets/irs/default_reverb.wav'); // Get the ArrayBuffer
                if (irArrayBuffer) {
                    // Decode the ArrayBuffer using the specific offlineCtx for this effect
                    decodedReverbIrBuffer = await new Promise((res, rej) => {
                        offlineCtx.decodeAudioData(
                            irArrayBuffer.slice(0), // Use slice(0) to create a copy if needed
                            (buffer) => res(buffer),
                            (err) => {
                                console.error(`Error decoding Reverb IR for ${offlineCtx.sampleRate}Hz context:`, err);
                                rej(err); // Propagate error for this specific decoding attempt
                            }
                        );
                    });
                    console.log(`Reverb IR decoded successfully for 8D effect.`);
                }
            } catch (error) {
                console.warn(`Reverb IR processing failed for 8D effect, proceeding without reverb. Error:`, error.message);
                // decodedReverbIrBuffer remains null
            }

            const audioSource = offlineCtx.createBufferSource();
            audioSource.buffer = inputBuffer;
            const stereoPanner = offlineCtx.createStereoPanner();

            const lfoPan1 = offlineCtx.createOscillator();
            lfoPan1.type = 'sine';
            lfoPan1.frequency.value = config.panSpeed;
            console.log(`[apply8DEffect] Setting lfoPan1.frequency.value to: ${config.panSpeed}`);
            const lfoPanDepth1 = offlineCtx.createGain();
            lfoPanDepth1.gain.value = config.lfoPanDepth1;
            console.log(`[apply8DEffect] Setting lfoPanDepth1.gain.value to: ${config.lfoPanDepth1}`);
            lfoPan1.connect(lfoPanDepth1);
            lfoPanDepth1.connect(stereoPanner.pan);

            const lfoPan2 = offlineCtx.createOscillator();
            lfoPan2.type = 'sine';
            lfoPan2.frequency.value = config.panSpeed * 1.66; // Maintain ratio
            console.log(`[apply8DEffect] Setting lfoPan2.frequency.value to: ${config.panSpeed * 1.66}`);
            const lfoPanDepth2 = offlineCtx.createGain();
            lfoPanDepth2.gain.value = config.lfoPanDepth2;
            console.log(`[apply8DEffect] Setting lfoPanDepth2.gain.value to: ${config.lfoPanDepth2}`);
            lfoPan2.connect(lfoPanDepth2);
            lfoPanDepth2.connect(stereoPanner.pan);

            audioSource.connect(stereoPanner);
            let signalProcessingNode = stereoPanner;

            const filterNode = offlineCtx.createBiquadFilter();
            filterNode.type = 'lowpass';
            filterNode.frequency.value = config.filterFreq;
            console.log(`[apply8DEffect] Setting filterNode.frequency.value to: ${config.filterFreq}`);
            filterNode.Q.value = 1; // Keep Q fixed for now, could be configurable

            const lfoFilter = offlineCtx.createOscillator();
            lfoFilter.type = 'sine';
            lfoFilter.frequency.value = config.lfoFilterSpeed;
            console.log(`[apply8DEffect] Setting lfoFilter.frequency.value to: ${config.lfoFilterSpeed}`);
            const lfoFilterDepth = offlineCtx.createGain();
            lfoFilterDepth.gain.value = 800; // Keep depth fixed, could be configurable
            lfoFilter.connect(lfoFilterDepth);
            lfoFilterDepth.connect(filterNode.frequency);

            signalProcessingNode.connect(filterNode);
            signalProcessingNode = filterNode; // Output of filter is now the main signal path

            const directGain = offlineCtx.createGain();
            signalProcessingNode.connect(directGain); // Filtered signal to directGain

            const delayNode = offlineCtx.createDelay(5.0); // Max delay time
            delayNode.delayTime.value = 0.35; // Fixed delay time
            const feedbackGain = offlineCtx.createGain();
            feedbackGain.gain.value = 0.4; // Fixed feedback
            const delayWetGain = offlineCtx.createGain();

            signalProcessingNode.connect(delayNode); // Filtered signal also to delay line
            delayNode.connect(feedbackGain);
            feedbackGain.connect(delayNode); // Feedback loop
            delayNode.connect(delayWetGain); // Output of delay line to its own gain control

            // Connect gains to destination
            directGain.connect(offlineCtx.destination);
            delayWetGain.connect(offlineCtx.destination);

            const configReverbMix = config.reverbMix;
            const configDelayMix = config.delayMix;
            let actualDirectGain = Math.max(0, 1 - configReverbMix - configDelayMix);
            let actualDelayGain = configDelayMix;
            let actualReverbGain = configReverbMix;
            let reverbWetGain;

            if (decodedReverbIrBuffer) {
                const convolver = offlineCtx.createConvolver();
                convolver.buffer = decodedReverbIrBuffer;
                convolver.normalize = true;
                reverbWetGain = offlineCtx.createGain();
                signalProcessingNode.connect(convolver);
                convolver.connect(reverbWetGain);
                reverbWetGain.connect(offlineCtx.destination);

                reverbWetGain.gain.value = actualReverbGain;
                delayWetGain.gain.value = actualDelayGain;
                directGain.gain.value = actualDirectGain;
                console.log(`[apply8DEffect] Reverb Active. Gains - Direct: ${actualDirectGain.toFixed(2)}, Delay: ${actualDelayGain.toFixed(2)}, Reverb: ${actualReverbGain.toFixed(2)}`);
            } else {
                const totalGainNoReverb = actualDirectGain + actualDelayGain;
                if (totalGainNoReverb > 0) {
                    directGain.gain.value = (actualDirectGain / totalGainNoReverb) * (actualDirectGain + actualDelayGain + actualReverbGain);
                    delayWetGain.gain.value = (actualDelayGain / totalGainNoReverb) * (actualDirectGain + actualDelayGain + actualReverbGain);
                } else {
                    directGain.gain.value = 1;
                    delayWetGain.gain.value = 0;
                }
                if(typeof reverbWetGain !== 'undefined' && reverbWetGain) reverbWetGain.gain.value = 0;
                console.log(`[apply8DEffect] No Reverb. Gains - Direct: ${directGain.gain.value.toFixed(2)}, Delay: ${delayWetGain.gain.value.toFixed(2)}`);
            }

            lfoPan1.start(0);
            lfoPan2.start(0);
            lfoFilter.start(0);
            audioSource.start(0);
            renderWithProgress(offlineCtx)
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

// --- 16D Effect Function ---
/**
 * Applies a 16D audio effect, aiming for a wide, spacious sound field with gentle movement.
 * Features:
 * - 3D PannerNode: Uses `PannerNode` with 'HRTF' panning model for high-quality spatialization.
 *   The sound source is positioned in 3D space.
 * - X-axis Oscillation: An LFO (`lfoX`) gently modulates the panner's X-axis position.
 *   - `config.pannerXOscRate`: Controls the speed of this oscillation.
 *   - `config.pannerXOscWidth`: Controls the width (amplitude) of the oscillation.
 * - Z-axis Positioning: The sound source can be positioned along the Z-axis.
 *   - `config.pannerZPos`: Sets the base Z position (e.g., slightly in front of the listener).
 * - Reverb: Adds spaciousness using convolution reverb.
 *   - `config.reverbMix`: Controls the wet/dry mix for the reverb.
 * - Configurable parameters:
 *   - `pannerXOscRate`: Speed of the X-axis panning LFO.
 *   - `pannerXOscWidth`: Width/amplitude of the X-axis panning.
 *   - `pannerZPos`: Base Z-axis position of the sound source.
 *   - `reverbMix`: Wet/dry mix for reverb.
 * - Gain Staging:
 *   - The output is a mix of the direct (panned) sound and the reverberated sound.
 *   - `directGain` is `1 - reverbMix`.
 *   - `reverbWetGain` is `reverbMix`. If reverb is not loaded, directGain becomes 1.0.
 * @param {AudioBuffer} inputBuffer - The original audio data.
 * @param {object} userConfig - User-defined configuration for the effect.
 * @returns {Promise<AudioBuffer>} A promise that resolves with the processed audio buffer.
 */
async function apply16DEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['16d'], ...userConfig }; // Merge user config with defaults
    console.log("[apply16DEffect] Received userConfig:", userConfig);
    console.log("[apply16DEffect] Applying 16D effect with final merged config:", config);

    return new Promise(async (resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);

            let decodedReverbIrBuffer = null;
            try {
                const irArrayBuffer = await getReverbIrArrayBuffer('assets/irs/default_reverb.wav'); // Get the ArrayBuffer
                if (irArrayBuffer) {
                    // Decode the ArrayBuffer using the specific offlineCtx for this effect
                    decodedReverbIrBuffer = await new Promise((res, rej) => {
                        offlineCtx.decodeAudioData(
                            irArrayBuffer.slice(0), // Use slice(0) to create a copy if needed
                            (buffer) => res(buffer),
                            (err) => {
                                console.error(`Error decoding Reverb IR for ${offlineCtx.sampleRate}Hz context:`, err);
                                rej(err); // Propagate error for this specific decoding attempt
                            }
                        );
                    });
                    console.log(`Reverb IR decoded successfully for 16D effect.`);
                }
            } catch (error) {
                console.warn(`Reverb IR processing failed for 16D effect, proceeding without reverb. Error:`, error.message);
                // decodedReverbIrBuffer remains null
            }

            const audioSource = offlineCtx.createBufferSource();
            audioSource.buffer = inputBuffer;

            const panner = offlineCtx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.positionX.value = 0; // Initial X position, will be modulated
            panner.positionY.value = 0; // Fixed Y position for 16D
            panner.positionZ.value = config.pannerZPos;
            console.log(`[apply16DEffect] Setting panner.positionZ.value to: ${config.pannerZPos}`);

            const lfoX = offlineCtx.createOscillator();
            lfoX.type = 'sine';
            lfoX.frequency.value = config.pannerXOscRate;
            console.log(`[apply16DEffect] Setting lfoX.frequency.value to: ${config.pannerXOscRate}`);

            const lfoXDepth = offlineCtx.createGain();
            lfoXDepth.gain.value = config.pannerXOscWidth;
            console.log(`[apply16DEffect] Setting lfoXDepth.gain.value to: ${config.pannerXOscWidth}`);

            lfoX.connect(lfoXDepth);
            lfoXDepth.connect(panner.positionX);

            audioSource.connect(panner);

            const directGain = offlineCtx.createGain();
            panner.connect(directGain);
            directGain.connect(offlineCtx.destination); // Connect direct path to destination

            const reverbMix = config.reverbMix;
            let reverbWetGain;

            if (decodedReverbIrBuffer) {
                const convolver = offlineCtx.createConvolver();
                convolver.buffer = decodedReverbIrBuffer;
                convolver.normalize = true;
                reverbWetGain = offlineCtx.createGain();

                panner.connect(convolver);
                convolver.connect(reverbWetGain);
                reverbWetGain.connect(offlineCtx.destination);

                reverbWetGain.gain.value = reverbMix;
                directGain.gain.value = 1 - reverbMix;
                console.log(`[apply16DEffect] Reverb Active. Gains - Direct: ${(1 - reverbMix).toFixed(2)}, Reverb: ${reverbMix.toFixed(2)}`);
            } else {
                directGain.gain.value = 1.0;
                if(typeof reverbWetGain !== 'undefined' && reverbWetGain) reverbWetGain.gain.value = 0; // Ensure reverb gain is 0 if node exists but not used
                console.log("[apply16DEffect] No Reverb. Gain - Direct: 1.0");
            }

            lfoX.start(0);
            audioSource.start(0);

            renderWithProgress(offlineCtx)
                .then(renderedBuffer => {
                    resolve(renderedBuffer);
                })
                .catch(err => {
                    reject(new Error("16D effect rendering failed: " + err.message));
                });
        } catch (error) {
            reject(new Error("Error in apply16DEffect: " + error.message));
        }
    });
}
// --- End 16D Effect Function ---

// --- 32D Effect Function ---
/**
 * Applies a 32D audio effect, creating a complex and immersive 3D sound field.
 * Features:
 * - 3D PannerNode: Utilizes `PannerNode` with 'HRTF' for realistic 3D sound positioning.
 * - Multi-LFO Modulation: Three separate LFOs modulate the panner's X, Y, and Z positions.
 *   This creates a less predictable, more enveloping movement compared to simpler effects.
 *   - X-axis LFO (`lfoPanX`): Sine wave for smooth left-right movement.
 *     - Controlled by `config.panXRate` (speed) and `config.panXWidth` (amplitude).
 *   - Y-axis LFO (`lfoPanY`): Triangle wave for up-down movement.
 *     - Controlled by `config.panYRate` (speed) and `config.panYWidth` (amplitude).
 *   - Z-axis LFO (`lfoPanZ`): Sawtooth wave for front-back movement with a reset, creating a
 *     sense of objects moving towards/away and then reappearing.
 *     - Controlled by `config.panZRate` (speed) and `config.panZWidth` (amplitude).
 * - Reverb: Convolution reverb adds to the sense of space.
 *   - `config.reverbMix`: Controls the wet/dry mix.
 * - Configurable parameters:
 *   - `panXRate`, `panXWidth`: Speed and amplitude for X-axis LFO.
 *   - `panYRate`, `panYWidth`: Speed and amplitude for Y-axis LFO.
 *   - `panZRate`, `panZWidth`: Speed and amplitude for Z-axis LFO.
 *   - `reverbMix`: Wet/dry mix for reverb.
 * - Gain Staging:
 *   - Similar to 16D, mixes direct (panned) sound and reverberated sound.
 *   - `directGain` is `1 - reverbMix`.
 *   - `reverbWetGain` is `reverbMix`. If reverb fails to load, `directGain` is 1.0.
 * @param {AudioBuffer} inputBuffer - The original audio data.
 * @param {object} userConfig - User-defined configuration for the effect.
 * @returns {Promise<AudioBuffer>} A promise that resolves with the processed audio buffer.
 */
async function apply32DEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['32d'], ...userConfig }; // Merge user config with defaults
    console.log("[apply32DEffect] Received userConfig:", userConfig);
    console.log("[apply32DEffect] Applying 32D effect with final merged config:", config);

    return new Promise(async (resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);

            let decodedReverbIrBuffer = null;
            try {
                const irArrayBuffer = await getReverbIrArrayBuffer('assets/irs/default_reverb.wav'); // Get the ArrayBuffer
                if (irArrayBuffer) {
                    // Decode the ArrayBuffer using the specific offlineCtx for this effect
                    decodedReverbIrBuffer = await new Promise((res, rej) => {
                        offlineCtx.decodeAudioData(
                            irArrayBuffer.slice(0), // Use slice(0) to create a copy if needed
                            (buffer) => res(buffer),
                            (err) => {
                                console.error(`Error decoding Reverb IR for ${offlineCtx.sampleRate}Hz context:`, err);
                                rej(err); // Propagate error for this specific decoding attempt
                            }
                        );
                    });
                    console.log(`Reverb IR decoded successfully for 32D effect.`);
                }
            } catch (error) {
                console.warn(`Reverb IR processing failed for 32D effect, proceeding without reverb. Error:`, error.message);
                // decodedReverbIrBuffer remains null
            }

            const audioSource = offlineCtx.createBufferSource();
            audioSource.buffer = inputBuffer;

            const panner = offlineCtx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            // Listener is at (0,0,0). Panner orientation default (forward).

            // X-axis movement
            const lfoPanX = offlineCtx.createOscillator();
            lfoPanX.type = 'sine';
            lfoPanX.frequency.value = config.panXRate;
            console.log(`[apply32DEffect] Setting lfoPanX.frequency.value to: ${config.panXRate}`);
            const lfoPanXDepth = offlineCtx.createGain();
            lfoPanXDepth.gain.value = config.panXWidth;
            console.log(`[apply32DEffect] Setting lfoPanXDepth.gain.value to: ${config.panXWidth}`);
            lfoPanX.connect(lfoPanXDepth);
            lfoPanXDepth.connect(panner.positionX);

            // Y-axis movement
            const lfoPanY = offlineCtx.createOscillator();
            lfoPanY.type = 'triangle';
            lfoPanY.frequency.value = config.panYRate;
            console.log(`[apply32DEffect] Setting lfoPanY.frequency.value to: ${config.panYRate}`);
            const lfoPanYDepth = offlineCtx.createGain();
            lfoPanYDepth.gain.value = config.panYWidth;
            console.log(`[apply32DEffect] Setting lfoPanYDepth.gain.value to: ${config.panYWidth}`);
            lfoPanY.connect(lfoPanYDepth);
            lfoPanYDepth.connect(panner.positionY);

            // Z-axis movement
            const lfoPanZ = offlineCtx.createOscillator();
            lfoPanZ.type = 'sawtooth';
            lfoPanZ.frequency.value = config.panZRate;
            console.log(`[apply32DEffect] Setting lfoPanZ.frequency.value to: ${config.panZRate}`);
            const lfoPanZDepth = offlineCtx.createGain();
            lfoPanZDepth.gain.value = config.panZWidth;
            console.log(`[apply32DEffect] Setting lfoPanZDepth.gain.value to: ${config.panZWidth}`);
            lfoPanZ.connect(lfoPanZDepth);
            lfoPanZDepth.connect(panner.positionZ);

            audioSource.connect(panner);

            const directGain = offlineCtx.createGain();
            panner.connect(directGain);
            directGain.connect(offlineCtx.destination); // Connect direct path to destination

            const reverbMix = config.reverbMix;
            let reverbWetGain;

            if (decodedReverbIrBuffer) {
                const convolver = offlineCtx.createConvolver();
                convolver.buffer = decodedReverbIrBuffer;
                convolver.normalize = true;
                reverbWetGain = offlineCtx.createGain();

                panner.connect(convolver);
                convolver.connect(reverbWetGain);
                reverbWetGain.connect(offlineCtx.destination);

                reverbWetGain.gain.value = reverbMix;
                directGain.gain.value = 1 - reverbMix;
                console.log(`[apply32DEffect] Reverb Active. Gains - Direct: ${(1 - reverbMix).toFixed(2)}, Reverb: ${reverbMix.toFixed(2)}`);
            } else {
                directGain.gain.value = 1.0;
                if(typeof reverbWetGain !== 'undefined' && reverbWetGain) reverbWetGain.gain.value = 0; // Ensure reverb gain is 0 if node exists but not used
                console.log("[apply32DEffect] No Reverb. Gain - Direct: 1.0");
            }

            lfoPanX.start(0);
            lfoPanY.start(0);
            lfoPanZ.start(0);
            audioSource.start(0);

            renderWithProgress(offlineCtx)
                .then(renderedBuffer => {
                    resolve(renderedBuffer);
                })
                .catch(err => {
                    reject(new Error("32D effect rendering failed: " + err.message));
                });
        } catch (error) {
            reject(new Error("Error in apply32DEffect: " + error.message));
        }
    });
}
// --- End 32D Effect Function ---

// --- 64D Effect Function ---
async function apply64DEffect(inputBuffer, userConfig = {}) {
    const defaultConfig = currentAudioConfig['64d'];
    const config = { ...defaultConfig, ...userConfig };
    return new Promise(async (resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error("OfflineAudioContext is not supported by this browser."));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);

            let decodedReverbIrBuffer = null;
            try {
                const irArrayBuffer = await getReverbIrArrayBuffer('assets/irs/default_reverb.wav');
                if (irArrayBuffer) {
                    decodedReverbIrBuffer = await new Promise((res, rej) => {
                        offlineCtx.decodeAudioData(irArrayBuffer.slice(0), b => res(b), err => rej(err));
                    });
                }
            } catch (error) {
                console.warn('Reverb IR processing failed for 64D effect:', error.message);
            }

            const audioSource = offlineCtx.createBufferSource();
            audioSource.buffer = inputBuffer;

            const panner = offlineCtx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';

            const lfoX = offlineCtx.createOscillator();
            lfoX.type = 'sine';
            lfoX.frequency.value = config.panXRate;
            const lfoXDepth = offlineCtx.createGain();
            lfoXDepth.gain.value = config.panXWidth;
            lfoX.connect(lfoXDepth);
            lfoXDepth.connect(panner.positionX);

            const lfoY = offlineCtx.createOscillator();
            lfoY.type = 'triangle';
            lfoY.frequency.value = config.panYRate;
            const lfoYDepth = offlineCtx.createGain();
            lfoYDepth.gain.value = config.panYWidth;
            lfoY.connect(lfoYDepth);
            lfoYDepth.connect(panner.positionY);

            const lfoZ = offlineCtx.createOscillator();
            lfoZ.type = 'sawtooth';
            lfoZ.frequency.value = config.panZRate;
            const lfoZDepth = offlineCtx.createGain();
            lfoZDepth.gain.value = config.panZWidth;
            lfoZ.connect(lfoZDepth);
            lfoZDepth.connect(panner.positionZ);

            audioSource.connect(panner);

            const directGain = offlineCtx.createGain();
            panner.connect(directGain);
            directGain.connect(offlineCtx.destination);

            let reverbWetGain;
            if (decodedReverbIrBuffer) {
                const convolver = offlineCtx.createConvolver();
                convolver.buffer = decodedReverbIrBuffer;
                convolver.normalize = true;
                reverbWetGain = offlineCtx.createGain();
                panner.connect(convolver);
                convolver.connect(reverbWetGain);
                reverbWetGain.connect(offlineCtx.destination);
                reverbWetGain.gain.value = config.reverbMix;
                directGain.gain.value = 1 - config.reverbMix;
            } else {
                directGain.gain.value = 1.0;
            }

            lfoX.start(0); lfoY.start(0); lfoZ.start(0); audioSource.start(0);
            renderWithProgress(offlineCtx).then(resolve).catch(err => reject(new Error('64D effect rendering failed: ' + err.message)));
        } catch (error) {
            reject(new Error('Error in apply64DEffect: ' + error.message));
        }
    });
}
// --- End 64D Effect Function ---

// --- Simple Effect Utilities ---
function applyReverseEffect(inputBuffer) {
    return new Promise((resolve, reject) => {
        try {
            const numberOfChannels = inputBuffer.numberOfChannels;
            const length = inputBuffer.length;
            const sampleRate = inputBuffer.sampleRate;
            const output = new AudioBuffer({ length, numberOfChannels, sampleRate });
            for (let ch = 0; ch < numberOfChannels; ch++) {
                const data = inputBuffer.getChannelData(ch);
                const reversed = new Float32Array(length);
                for (let i = 0; i < length; i++) {
                    reversed[i] = data[length - 1 - i];
                }
                output.copyToChannel(reversed, ch);
            }
            resolve(output);
        } catch (e) {
            reject(new Error('Error in applyReverseEffect: ' + e.message));
        }
    });
}

function applyBassBoostEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['bassboost'], ...userConfig };
    return new Promise((resolve, reject) => {
        try {
            const offlineCtx = new OfflineAudioContext(inputBuffer.numberOfChannels, inputBuffer.length, inputBuffer.sampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = inputBuffer;
            const filter = offlineCtx.createBiquadFilter();
            filter.type = 'lowshelf';
            filter.frequency.value = 200;
            filter.gain.value = config.gain;
            source.connect(filter);
            filter.connect(offlineCtx.destination);
            source.start(0);
            renderWithProgress(offlineCtx).then(resolve).catch(err => reject(new Error('Bass boost rendering failed: ' + err.message)));
        } catch (e) {
            reject(new Error('Error in applyBassBoostEffect: ' + e.message));
        }
    });
}

function applyEchoEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['echo'], ...userConfig };
    return new Promise((resolve, reject) => {
        try {
            const offlineCtx = new OfflineAudioContext(inputBuffer.numberOfChannels, inputBuffer.length + inputBuffer.sampleRate * config.delayTime, inputBuffer.sampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = inputBuffer;
            const delayNode = offlineCtx.createDelay();
            delayNode.delayTime.value = config.delayTime;
            const feedback = offlineCtx.createGain();
            feedback.gain.value = config.feedback;
            delayNode.connect(feedback);
            feedback.connect(delayNode);
            const merger = offlineCtx.createGain();
            source.connect(delayNode);
            source.connect(merger);
            delayNode.connect(merger);
            merger.connect(offlineCtx.destination);
            source.start(0);
            renderWithProgress(offlineCtx).then(resolve).catch(err => reject(new Error('Echo rendering failed: ' + err.message)));
        } catch (e) {
            reject(new Error('Error in applyEchoEffect: ' + e.message));
        }
    });
}

function applyPitchShiftEffect(inputBuffer, factor) {
    return new Promise((resolve, reject) => {
        try {
            const newLength = Math.ceil(inputBuffer.length / factor);
            const offlineCtx = new OfflineAudioContext(inputBuffer.numberOfChannels, newLength, inputBuffer.sampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = inputBuffer;
            source.playbackRate.value = factor;
            source.connect(offlineCtx.destination);
            source.start(0);
            renderWithProgress(offlineCtx).then(resolve).catch(err => reject(new Error('Pitch shift failed: ' + err.message)));
        } catch (e) {
            reject(new Error('Error in applyPitchShiftEffect: ' + e.message));
        }
    });
}

function applySpeedChangeEffect(inputBuffer, factor) {
    return applyPitchShiftEffect(inputBuffer, factor);
}

async function applyReverbOnlyEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['reverb'], ...userConfig };
    return new Promise(async (resolve, reject) => {
        try {
            if (!window.OfflineAudioContext) {
                reject(new Error('OfflineAudioContext is not supported by this browser.'));
                return;
            }
            const offlineCtx = new OfflineAudioContext(2, inputBuffer.length, inputBuffer.sampleRate);
            let decodedReverbIrBuffer = null;
            try {
                const irArrayBuffer = await getReverbIrArrayBuffer('assets/irs/default_reverb.wav');
                if (irArrayBuffer) {
                    decodedReverbIrBuffer = await new Promise((res, rej) => {
                        offlineCtx.decodeAudioData(irArrayBuffer.slice(0), b => res(b), err => rej(err));
                    });
                }
            } catch (error) {
                console.warn('Reverb IR processing failed for reverb effect:', error.message);
            }

            const source = offlineCtx.createBufferSource();
            source.buffer = inputBuffer;
            const dry = offlineCtx.createGain();
            const wet = offlineCtx.createGain();
            dry.gain.value = 1 - config.mix;
            wet.gain.value = config.mix;
            const convolver = offlineCtx.createConvolver();
            convolver.buffer = decodedReverbIrBuffer;
            source.connect(dry);
            dry.connect(offlineCtx.destination);
            source.connect(convolver);
            convolver.connect(wet);
            wet.connect(offlineCtx.destination);
            source.start(0);
            renderWithProgress(offlineCtx).then(resolve).catch(err => reject(new Error('Reverb rendering failed: ' + err.message)));
        } catch (e) {
            reject(new Error('Error in applyReverbOnlyEffect: ' + e.message));
        }
    });
}

// High Quality Oversampling Effect
function applyHQEffect(inputBuffer, userConfig = {}) {
    const config = { ...currentAudioConfig['hq'], ...userConfig };
    return new Promise((resolve, reject) => {
        try {
            let factor = parseInt(config.oversample);
            if (!factor) {
                factor = Math.ceil(44100 / inputBuffer.sampleRate);
            }
            factor = Math.max(1, Math.min(factor, 4));
            if (!window.OfflineAudioContext) {
                reject(new Error('OfflineAudioContext is not supported by this browser.'));
                return;
            }
            const upCtx = new OfflineAudioContext(inputBuffer.numberOfChannels, inputBuffer.length * factor, inputBuffer.sampleRate * factor);
            const upSrc = upCtx.createBufferSource();
            upSrc.buffer = inputBuffer;
            upSrc.connect(upCtx.destination);
            upSrc.start(0);
            renderWithProgress(upCtx).then(upBuffer => {
                const downCtx = new OfflineAudioContext(inputBuffer.numberOfChannels, inputBuffer.length, inputBuffer.sampleRate);
                const downSrc = downCtx.createBufferSource();
                downSrc.buffer = upBuffer;
                downSrc.connect(downCtx.destination);
                downSrc.start(0);
                return renderWithProgress(downCtx);
            }).then(resolve).catch(err => reject(new Error('Quality Boost failed: ' + err.message)));
        } catch (e) {
            reject(new Error('Error in applyHQEffect: ' + e.message));
        }
    });
}
// --- End Simple Effect Utilities ---

// --- Reverb IR Loading Function ---
// Fetches the Reverb IR file and returns a promise that resolves with its ArrayBuffer.
// Caches the promise to avoid multiple fetches for the same IR.
async function getReverbIrArrayBuffer(irUrl = 'assets/irs/default_reverb.wav') {
    // Ensure irArrayBufferPromise is defined in a scope accessible here or passed appropriately.
    // For this example, assuming it's a global or module-scoped variable initialized to null.
    if (irArrayBufferPromise && irUrl === getReverbIrArrayBuffer.lastIrUrl) { // Check if URL is same as cached
        console.log("Reverb IR ArrayBuffer fetch already in progress or completed for this URL. Returning cached promise.");
        return irArrayBufferPromise;
    }

    console.log("Fetching Reverb IR ArrayBuffer from:", irUrl);
    // Store the URL for which this promise is being created
    getReverbIrArrayBuffer.lastIrUrl = irUrl;

    irArrayBufferPromise = new Promise(async (resolve, reject) => {
        try {
            const response = await fetch(irUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} while fetching ${irUrl}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            console.log("Reverb IR ArrayBuffer fetched successfully.");
            resolve(arrayBuffer);
        } catch (error) {
            console.error("Failed to fetch Reverb IR ArrayBuffer:", error);
            if (getReverbIrArrayBuffer.lastIrUrl === irUrl) { // Only clear if it's for the failed URL
                irArrayBufferPromise = null;
                getReverbIrArrayBuffer.lastIrUrl = null;
            }
            reject(error);
        }
    });
    return irArrayBufferPromise;
}
getReverbIrArrayBuffer.lastIrUrl = null; // Initialize static-like property for the function
// --- End Reverb IR Loading Function ---
