import React, { useState, useRef } from 'react';

// --- Funciones auxiliares para la conversión de audio ---
// Estas funciones no forman parte del componente, por lo que se definen fuera.

/**
 * Convierte una cadena base64 a un ArrayBuffer.
 * @param {string} base64 - La cadena base64 a convertir.
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Escribe una cadena de texto en un DataView.
 * @param {DataView} view - El DataView en el que se escribirá.
 * @param {number} offset - La posición donde empezar a escribir.
 * @param {string} string - La cadena a escribir.
 */
function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * Convierte datos de audio PCM crudo a un Blob en formato WAV.
 * La API devuelve audio L16 (PCM crudo), que los navegadores no pueden reproducir
 * directamente. Esta función lo empaqueta en un contenedor WAV.
 * @param {Int16Array} pcmData - Los datos de audio PCM de 16 bits.
 * @param {number} sampleRate - La frecuencia de muestreo del audio (ej. 24000).
 * @returns {Blob} Un Blob que contiene el audio en formato WAV.
 */
function pcmToWav(pcmData, sampleRate) {
    const numSamples = pcmData.length;
    const numChannels = 1; // Audio mono
    const bytesPerSample = 2; // 16-bit
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


// --- Componente principal de la aplicación ---
export default function App() {
    const [text, setText] = useState('Hola, ¿cómo estás hoy?');
    const [selectedVoice, setSelectedVoice] = useState('Zephyr');
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState({ message: '', type: '' });
    const [audioUrl, setAudioUrl] = useState('');
    
    const audioRef = useRef(null);

    const voices = [
        { value: 'Zephyr', label: 'Zephyr (Brillante)' },
        { value: 'Puck', label: 'Puck (Animada)' },
        { value: 'Charon', label: 'Charon (Informativa)' },
        { value: 'Kore', label: 'Kore (Firme)' },
        { value: 'Fenrir', label: 'Fenrir (Entusiasta)' },
        { value: 'Leda', label: 'Leda (Juvenil)' },
        { value: 'Sadachbia', label: 'Sadachbia (Vivaz)' },
        { value: 'Sulafat', label: 'Sulafat (Cálida)' },
    ];

    const callTtsApi = async (textToSpeak, voice) => {
        const apiKey = ""; // Canvas proporcionará la clave de API en tiempo de ejecución.
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: `Di esto con una voz clara y natural: ${textToSpeak}` }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
            },
            model: "gemini-2.5-flash-preview-tts"
        };

        for (let i = 0, delay = 1000; i < 3; i++, delay *= 2) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const result = await response.json();
                    const part = result?.candidates?.[0]?.content?.parts?.[0];
                    const audioData = part?.inlineData?.data;
                    const mimeType = part?.inlineData?.mimeType;

                    if (audioData && mimeType?.startsWith("audio/")) {
                        return { audioData, mimeType };
                    }
                    throw new Error("La respuesta de la API no contenía datos de audio válidos.");
                } else if (response.status === 401) {
                    throw new Error("Error de autenticación (401). La clave de API no es válida o no está configurada.");
                } else if (response.status === 429 || response.status >= 500) {
                     console.warn(`Intento ${i + 1} fallido con estado ${response.status}. Reintentando...`);
                     await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    const errorBody = await response.text();
                    throw new Error(`Error en la API: ${response.status}. ${errorBody}`);
                }
            } catch (error) {
                if (i === 2) throw error; // Lanzar el error en el último reintento
            }
        }
        throw new Error("No se pudo obtener una respuesta de la API después de varios intentos.");
    };

    const handleGenerate = async () => {
        if (!text.trim()) {
            setStatus({ message: "Por favor, introduce algún texto.", type: "error" });
            return;
        }

        setIsLoading(true);
        setStatus({ message: '', type: '' });
        setAudioUrl('');

        try {
            const audioData = await callTtsApi(text, selectedVoice);
            if (audioData) {
                const mimeType = audioData.mimeType || 'audio/L16; rate=24000';
                const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;
                
                const pcmData = base64ToArrayBuffer(audioData.audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
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
    
    // Efecto para reproducir el audio cuando la URL cambia
    React.useEffect(() => {
        if (audioUrl && audioRef.current) {
            audioRef.current.play();
        }
    }, [audioUrl]);

    return (
        <div className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center min-h-screen p-4 font-sans">
            <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 md:p-8 space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Texto a Voz con IA</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">Usa la API de Gemini para convertir tu texto en audio.</p>
                </div>

                <div className="space-y-4">
                    <div>
                        <label htmlFor="text-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Introduce el texto aquí
                        </label>
                        <textarea
                            id="text-input"
                            rows="6"
                            className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                            placeholder="Escribe algo para convertirlo en voz..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                        />
                    </div>
                    <div>
                        <label htmlFor="voice-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Selecciona una voz
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
                </div>

                <div className="flex flex-col items-center justify-center space-y-4">
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="w-full md:w-auto px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Generando...' : 'Generar Audio'}
                    </button>
                    <div className="h-10 flex items-center justify-center">
                        {isLoading && (
                             <div className="border-4 border-gray-200 border-t-blue-500 rounded-full w-8 h-8 animate-spin"></div>
                        )}
                        {status.message && (
                            <p className={status.type === 'error' ? 'text-red-500' : 'text-green-500'}>
                                {status.message}
                            </p>
                        )}
                    </div>
                </div>

                {audioUrl && (
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">Audio generado:</p>
                        <audio ref={audioRef} controls src={audioUrl} className="w-full"></audio>
                    </div>
                )}
            </div>
        </div>
    );
}
