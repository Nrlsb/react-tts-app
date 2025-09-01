import React, { useState, useRef, useEffect } from 'react';

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
    const [text, setText] = useState('Hola, el clima para hoy en Esperanza, Santa Fe será soleado con una máxima de 25 grados.');
    const [selectedVoice, setSelectedVoice] = useState('Kore');
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState({ message: '', type: '' });
    const [audioUrl, setAudioUrl] = useState('');
    const audioRef = useRef(null);
    const CHARACTER_LIMIT = 500;

    // MEJORA 1: Lista de voces ampliada y más descriptiva
    const voices = [
        // Voces Masculinas
        { value: 'Puck', label: 'Puck (Animada, Masculina)' },
        { value: 'Charon', label: 'Charon (Informativa, Masculina)' },
        { value: 'Fenrir', label: 'Fenrir (Entusiasta, Masculina)' },
        { value: 'Orus', label: 'Orus (Firme, Masculina)' },
        { value: 'Algenib', label: 'Algenib (Grave, Masculina)' },
        { value: 'Sadaltager', label: 'Sadaltager (Experta, Masculina)' },
        // Voces Femeninas
        { value: 'Kore', label: 'Kore (Firme, Femenina)' },
        { value: 'Zephyr', label: 'Zephyr (Brillante, Femenina)' },
        { value: 'Leda', label: 'Leda (Juvenil, Femenina)' },
        { value: 'Aoede', label: 'Aoede (Fresca, Femenina)' },
        { value: 'Autonoe', label: 'Autonoe (Brillante, Femenina)' },
        { value: 'Sulafat', label: 'Sulafat (Cálida, Femenina)' },
    ];

    const callBackendApi = async (textToSpeak, voice) => {
        // Se revirtió el cambio para asegurar la compatibilidad.
        const backendUrl = 'https://tts-app-backend-cp16.onrender.com/api/generate-tts'; // URL de producción

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textToSpeak, voice: voice })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Error del servidor: ${response.status}`);
        }

        return await response.json();
    };

    const handleGenerate = async () => {
        if (!text.trim()) {
            setStatus({ message: "Por favor, introduce algún texto.", type: "error" });
            return;
        }
        if (text.length > CHARACTER_LIMIT) {
            setStatus({ message: `El texto no puede superar los ${CHARACTER_LIMIT} caracteres.`, type: "error"});
            return;
        }

        setIsLoading(true);
        setStatus({ message: '', type: '' });
        setAudioUrl('');

        try {
            const result = await callBackendApi(text, selectedVoice);
            if (result && result.audioData) {
                const mimeType = result.mimeType || 'audio/L16; rate=24000';
                const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;
                
                const pcmData = base64ToArrayBuffer(result.audioData);
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
    useEffect(() => {
        if (audioUrl && audioRef.current) {
            audioRef.current.play();
        }
    }, [audioUrl]);

    const handleClearText = () => {
        setText('');
        setAudioUrl('');
        setStatus({ message: '', type: ''});
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
                            {/* MEJORA 3: Botón para limpiar el texto */}
                            <button onClick={handleClearText} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition">
                                Limpiar
                            </button>
                        </div>
                        <textarea
                            id="text-input"
                            rows="6"
                            className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                            placeholder="Escribe algo para convertirlo en voz..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                        />
                         {/* MEJORA 4: Contador de caracteres */}
                        <p className={`text-xs text-right mt-1 ${text.length > CHARACTER_LIMIT ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                            {text.length} / {CHARACTER_LIMIT}
                        </p>
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
                        disabled={isLoading || text.length > CHARACTER_LIMIT}
                        className="w-full md:w-auto px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Generando...' : 'Generar Audio'}
                    </button>
                    <div className="h-10 flex items-center justify-center">
                        {isLoading && (
                             <div className="border-4 border-gray-200 border-t-blue-500 rounded-full w-8 h-8 animate-spin"></div>
                        )}
                        {status.message && (
                            <p className={`text-sm text-center ${status.type === 'error' ? 'text-red-500' : 'text-green-500'}`}>
                                {status.message}
                            </p>
                        )}
                    </div>
                </div>

                {audioUrl && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">Audio generado:</p>
                        <audio ref={audioRef} controls src={audioUrl} className="w-full"></audio>
                        {/* MEJORA 5: Botón de descarga */}
                        <div className="text-center">
                            <a
                              href={audioUrl}
                              download="audio_generado.wav"
                              className="inline-block px-6 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-300"
                            >
                                Descargar Audio (WAV)
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

