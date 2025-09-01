import express from 'express';
import axios from 'axios';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3001;

// --- Middlewares ---
// Habilita CORS para permitir solicitudes desde tu frontend de React
app.use(cors({
  origin: '*' // Para desarrollo. En producción, cámbialo a la URL de tu frontend.
}));
// Permite al servidor entender JSON en el cuerpo de las solicitudes
app.use(express.json());


// --- Ruta de la API ---
app.post('/api/generate-tts', async (req, res) => {
  // Extrae el texto y la voz del cuerpo de la solicitud
  const { text, voice } = req.body;
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!text || !voice) {
    return res.status(400).json({ error: 'Faltan los parámetros "text" y "voice".' });
  }

  if (!apiKey || apiKey === "TU_API_KEY_AQUI") {
    return res.status(500).json({ error: 'La clave de API no está configurada en el servidor. Revisa el archivo .env.' });
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: `Di esto con una voz clara y natural: ${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    },
    model: "gemini-2.5-flash-preview-tts"
  };

  try {
    console.log('Enviando solicitud a la API de Gemini...');
    const response = await axios.post(apiUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('Respuesta recibida de la API de Gemini.');
    const part = response.data?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (audioData && mimeType) {
      res.status(200).json({ audioData, mimeType });
    } else {
      console.error('Respuesta inválida de la API:', response.data);
      res.status(500).json({ error: 'La respuesta de la API no contenía datos de audio válidos.' });
    }

  } catch (error) {
    console.error('Error al llamar a la API de Gemini:', error.response ? error.response.data : error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response ? error.response.data.error.message : 'Error interno del servidor.';
    res.status(status).json({ error: `Error en la API de Google: ${message}` });
  }
});


// --- Iniciar el servidor ---
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
