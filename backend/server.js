// Importar los módulos necesarios
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---
const corsOptions = {
  origin: 'https://react-tts-app.vercel.app', 
  optionsSuccessStatus: 200 
};
app.use(cors(corsOptions));
app.use(express.json());


// --- Ruta de la API ---
app.post('/api/generate-tts', async (req, res) => {
    // Recibir los nuevos campos 'style' y 'speakingRate' desde el body
    const { text, voice, style, speakingRate } = req.body;
    const apiKey = process.env.GOOGLE_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    if (!text || !voice) {
        return res.status(400).json({ error: 'Faltan los parámetros "text" o "voice".' });
    }

    if (!apiKey) {
        return res.status(500).json({ error: 'La clave de API no está configurada en el servidor.' });
    }
    
    // Construir el prompt final para la API
    const finalText = style && style.trim() !== ''
        ? `Dilo ${style}: ${text}`
        : `Di esto con una voz clara y natural: ${text}`;

    // Construir el objeto voiceConfig dinámicamente
    const voiceConfig = {
        prebuiltVoiceConfig: { voiceName: voice }
    };

    // Añadir speakingRate a voiceConfig solo si se proporciona un valor numérico válido
    if (speakingRate && !isNaN(speakingRate)) {
        voiceConfig.speakingRate = parseFloat(speakingRate);
    }

    const payload = {
        contents: [{ parts: [{ text: finalText }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: voiceConfig } // Usar el objeto voiceConfig actualizado
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    try {
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            console.error('Error de la API de Google:', errorBody);
            return res.status(apiResponse.status).json({ error: `Error en la API de Google: ${errorBody}` });
        }

        const result = await apiResponse.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType?.startsWith("audio/")) {
            res.json({ audioData, mimeType });
        } else {
            res.status(500).json({ error: "La respuesta de la API no contenía datos de audio válidos." });
        }

    } catch (error) {
        console.error('Error interno del servidor:', error);
        res.status(500).json({ error: 'Error interno al procesar la solicitud.' });
    }
});


// --- Iniciar el servidor ---
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});


