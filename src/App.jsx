import React, { useState, useRef, useEffect } from 'react';

// --- Funciones auxiliares para la conversión de audio ---

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function pcmToWav(pcmData, sampleRate) {
    const numSamples = pcmData.length;
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < numSamples; i++) {
        view.setInt16(44 + i * 2, pcmData[i], true);
    }

    return new Blob([view], { type: 'audio/wav' });
}

function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i, sample, offset = 0, pos = 0;

    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, length - 8, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numOfChan, true); offset += 2;
    view.setUint32(offset, buffer.sampleRate, true); offset += 4;
    view.setUint32(offset, buffer.sampleRate * 2 * numOfChan, true); offset += 4;
    view.setUint16(offset, numOfChan * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, length - pos - 4, true); offset += 4;

    for (i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    while (pos < buffer.length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][pos]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
        pos++;
    }

    return new Blob([view], { type: 'audio/wav' });
}

// --- Componente principal de la aplicación ---
export default function App() {
    const [text, setText] = useState('Hola, el clima para hoy en Esperanza, Santa Fe será soleado con una máxima de 25 grados.');
    const [selectedVoice, setSelectedVoice] = useState('Kore');
    const [stylePrompt, setStylePrompt] = useState('');
    const [speakingRate, setSpeakingRate] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessingDownload, setIsProcessingDownload] = useState(false);
    const [status, setStatus] = useState({ message: '', type: '' });
    const [audioUrl, setAudioUrl] = useState('');
    
    const audioRef = useRef(null);
    const originalAudioBlob = useRef(null);
    const workerRef = useRef(null);
    const MAX_CHARS = 5000;
    const backendUrl = 'https://tts-app-backend-cp16.onrender.com/api/generate-tts';
    
    useEffect(() => {
        const soundTouchUrl = new URL('/sound-touch.js', window.location.origin).href;

        // --- INICIO: Lógica del Worker de Audio (Corregida) ---
        const workerScript = `
            try {
                importScripts('${soundTouchUrl}');
            } catch (e) {
                self.postMessage({ error: 'No se pudo cargar la librería de procesamiento de audio: ' + e.message });
                throw e; 
            }

            self.onmessage = (e) => {
                const { buffer, sampleRate, tempo } = e.data;
                
                // 1. Crear un 'source' que la librería pueda consumir.
                const source = {
                    position: 0,
                    get: function(frameCount) {
                        if (this.position >= buffer.length) {
                            return null; // Fin del buffer
                        }
                        const end = Math.min(this.position + frameCount, buffer.length);
                        // La librería espera audio estéreo intercalado (interleaved).
                        // Creamos un buffer estéreo duplicando nuestro canal mono.
                        const monoChunk = buffer.subarray(this.position, end);
                        const stereoChunk = new Float32Array(monoChunk.length * 2);
                        for (let i = 0; i < monoChunk.length; i++) {
                            stereoChunk[i * 2] = monoChunk[i];
                            stereoChunk[i * 2 + 1] = monoChunk[i];
                        }
                        this.position = end;
                        return stereoChunk;
                    }
                };

                // 2. Crear un objeto 'pipeSource' con las propiedades que SoundTouch.P espera.
                const pipeSource = {
                    sampleRate: sampleRate,
                    tempo: tempo,
                    pitch: 1.0,
                    rate: 1.0,
                    get: source.get.bind(source), // ¡Importante! 'bind(this)' para mantener el contexto.
                    end: () => null,
                    clear: () => {},
                    off: () => {},
                    on: () => {},
                    clone: function() { return this; }
                };

                try {
                    // 3. Crear la instancia del procesador SoundTouch (el 'pipe').
                    const soundtouch_pipe = new self.SoundTouch.P(pipeSource);
                    soundtouch_pipe.tempo = tempo; // Asignar el tempo deseado.
                    
                    const all_processed_data = [];
                    const CHUNK_SIZE = 8192;
                    let processed_chunk_stereo;

                    // 4. Procesar el audio en fragmentos (chunks) hasta que no quede más.
                    do {
                        // getSamples devuelve audio estéreo desintercalado: [canal_izquierdo, canal_derecho]
                        processed_chunk_stereo = soundtouch_pipe.getSamples(CHUNK_SIZE); 
                        if (processed_chunk_stereo && processed_chunk_stereo[0].length > 0) {
                            // Nos quedamos solo con un canal para tener audio mono.
                            all_processed_data.push(processed_chunk_stereo[0]);
                        }
                    } while (processed_chunk_stereo && processed_chunk_stereo[0].length > 0);

                    // 5. Concatenar todos los fragmentos procesados en un único array.
                    const totalLength = all_processed_data.reduce((sum, arr) => sum + arr.length, 0);
                    const result = new Float32Array(totalLength);
                    let offset = 0;
                    for (const chunk of all_processed_data) {
                        result.set(chunk, offset);
                        offset += chunk.length;
                    }

                    // 6. Enviar el resultado final al hilo principal.
                    self.postMessage({ result });

                } catch(err) {
                    self.postMessage({ error: 'Error dentro del worker: ' + err.message });
                }
            };
        `;
        // --- FIN: Lógica del Worker de Audio (Corregida) ---
        
        try {
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            workerRef.current = new Worker(URL.createObjectURL(blob));
        } catch (error) {
            console.error("No se pudo crear el worker:", error);
            setStatus({ message: "No se pudo inicializar el procesador de audio.", type: "error" });
        }

        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, []);


    const voices = [
        { value: 'Zephyr', label: 'Zephyr (Brillante, Femenina)' },
        { value: 'Puck', label: 'Puck (Animada, Masculina)' },
        { value: 'Charon', label: 'Charon (Informativa, Masculina)' },
        { value: 'Kore', label: 'Kore (Firme, Femenina)' },
        { value: 'Fenrir', label: 'Fenrir (Entusiasta, Masculina)' },
        { value: 'Leda', label: 'Leda (Juvenil, Femenina)' },
        { value: 'Orus', label: 'Orus (Firme, Masculina)' },
        { value: 'Aoede', label: 'Aoede (Alegre, Femenina)' },
        { value: 'Sadachbia', label: 'Sadachbia (Vivaz, Femenina)' },
        { value: 'Sulafat', label: 'Sulafat (Cálida, Femenina)' },
    ];

    const callBackendApi = async (textToSpeak, voice, style) => {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textToSpeak, voice, style })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Error del servidor: ${response.status}`);
        }
        return await response.json();
    };

    const handleGenerate = async () => {
        if (!text.trim() || text.length > MAX_CHARS) {
            setStatus({ message: "Por favor, introduce texto válido y no excedas el límite.", type: "error" });
            return;
        }
        setIsLoading(true);
        setStatus({ message: '', type: '' });
        setAudioUrl('');
        originalAudioBlob.current = null;
        try {
            const result = await callBackendApi(text, selectedVoice, stylePrompt);
            if (result && result.audioData) {
                const mimeType = result.mimeType || 'audio/L16; rate=24000';
                const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;
                
                const pcmData = base64ToArrayBuffer(result.audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                originalAudioBlob.current = wavBlob;
                
                const url = URL.createObjectURL(wavBlob);
                setAudioUrl(url);
                setStatus({ message: "¡Audio generado con éxito!", type: "success" });
            }
        } catch (error) {
            console.error("Error al generar audio:", error);
            setStatus({ message: `Error: ${error.message}`, type: "error" });
        } finally {
            setIsLoading(false);
        }
    };
    
    useEffect(() => {
        if (audioUrl && audioRef.current) {
            audioRef.current.playbackRate = speakingRate;
            audioRef.current.play();
        }
    }, [audioUrl]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = speakingRate;
        }
    }, [speakingRate]);

    const handleClear = () => {
        setText('');
        setAudioUrl('');
        originalAudioBlob.current = null;
        setStatus({ message: '', type: '' });
    };

    const triggerDownload = (blob, speed) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audio-HQ-${speed.toFixed(1)}x.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    const handleModifiedDownload = async () => {
        if (!originalAudioBlob.current || !workerRef.current) {
            setStatus({ message: 'El procesador de audio no está listo. Inténtalo de nuevo.', type: 'error' });
            return;
        }
    
        setIsProcessingDownload(true);
        setStatus({ message: 'Procesando audio (puede tardar)...', type: 'info' });

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await originalAudioBlob.current.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            workerRef.current.postMessage({
                buffer: audioBuffer.getChannelData(0),
                sampleRate: audioBuffer.sampleRate,
                tempo: speakingRate
            });

            workerRef.current.onmessage = (e) => {
                if (e.data.error) {
                    console.error("Error desde el worker:", e.data.error);
                    setStatus({ message: `Error de procesamiento: ${e.data.error}`, type: "error" });
                    setIsProcessingDownload(false);
                    return;
                }

                const processedSamples = e.data.result;
                const newAudioBuffer = audioCtx.createBuffer(1, processedSamples.length, audioBuffer.sampleRate);
                newAudioBuffer.copyToChannel(processedSamples, 0);

                const processedWavBlob = audioBufferToWav(newAudioBuffer);
                triggerDownload(processedWavBlob, speakingRate);
                setStatus({ message: '¡Descarga de alta calidad iniciada!', type: 'success' });
                setIsProcessingDownload(false);
            };

            workerRef.current.onerror = (err) => {
                console.error("Error en el Worker de audio:", err);
                setStatus({ message: `Error al procesar: ${err.message}`, type: "error" });
                setIsProcessingDownload(false);
            };

        } catch (error) {
            console.error("Error preparando el procesamiento de audio:", error);
            setStatus({ message: `Error al preparar: ${error.message}`, type: "error" });
            setIsProcessingDownload(false);
        }
    };

    return (
        <div className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center min-h-screen p-4 font-sans">
            <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 md:p-8 space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Texto a Voz con IA</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">Usa la API de Gemini para convertir tu texto en audio.</p>
                </div>

                <div className="space-y-4">
                     <div>
                        <div className="flex justify-between items-center mb-2">
                            <label htmlFor="text-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Introduce el texto aquí
                            </label>
                            <button onClick={handleClear} className="text-sm text-blue-500 hover:underline">Limpiar</button>
                        </div>
                        <textarea
                            id="text-input"
                            rows="6"
                            className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                            placeholder="Escribe algo para convertirlo en voz..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                        />
                         <p className={`text-right text-sm mt-1 ${text.length > MAX_CHARS ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                            {text.length} / {MAX_CHARS}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="voice-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Voz
                            </label>
                            <select
                                id="voice-select"
                                className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                                value={selectedVoice}
                                onChange={(e) => setSelectedVoice(e.target.value)}
                            >
                                {voices.map(voice => (
                                    <option key={voice.value} value={voice.value}>{voice.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="style-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Tono o Estilo (opcional)
                            </label>
                            <input
                                type="text"
                                id="style-prompt"
                                className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                                placeholder="Ej: alegre, susurrando..."
                                value={stylePrompt}
                                onChange={(e) => setStylePrompt(e.target.value)}
                            />
                        </div>
                    </div>
                     <div>
                        <label htmlFor="speed-control" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                           Velocidad de Lectura: <span className="font-bold text-blue-500">{speakingRate.toFixed(1)}x</span>
                        </label>
                        <input
                            id="speed-control"
                            type="range"
                            min="0.5"
                            max="2"
                            step="0.1"
                            value={speakingRate}
                            onChange={(e) => setSpeakingRate(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                        />
                    </div>
                </div>

                <div className="flex flex-col items-center justify-center space-y-4">
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading || isProcessingDownload || text.length > MAX_CHARS}
                        className="w-full md:w-auto px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Generando...' : 'Generar Audio'}
                    </button>
                     <div className="h-10 flex items-center justify-center">
                        {(isLoading || isProcessingDownload) && (
                             <div className="border-4 border-gray-200 border-t-blue-500 rounded-full w-8 h-8 animate-spin"></div>
                        )}
                        {status.message && (
                            <p className={`text-center ${status.type === 'error' ? 'text-red-500' : status.type === 'info' ? 'text-blue-500' : 'text-green-500'}`}>
                                {status.message}
                            </p>
                        )}
                    </div>
                </div>

                {audioUrl && (
                    <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">Audio generado:</p>
                        <audio ref={audioRef} controls src={audioUrl} className="w-full"></audio>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                             <button
                                onClick={() => triggerDownload(originalAudioBlob.current, 1.0)}
                                disabled={isProcessingDownload}
                                className="w-full sm:w-auto px-6 py-2 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition duration-300 disabled:opacity-50"
                            >
                                Original (1.0x)
                            </button>
                             <button
                                onClick={handleModifiedDownload}
                                disabled={isProcessingDownload || speakingRate === 1 || !workerRef.current}
                                className="w-full sm:w-auto px-6 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isProcessingDownload ? 'Procesando...' : `Tono Corregido (${speakingRate.toFixed(1)}x)`}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
