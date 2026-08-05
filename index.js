const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error("❌ ERROR CRÍTICO: Faltan las variables TELEGRAM_TOKEN o GEMINI_API_KEY en Render.");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Almacenamiento temporal del último ticket por chat
const historialChats = {};

const SYSTEM_PROMPT = `
Eres un asistente técnico de telecomunicaciones para la empresa ThunderNet.

INSTRUCCIONES DE EXTRACCIÓN FLEXIBLE:
1. Recibirás un ticket de avería de fibra óptica en texto y/o el dictado (texto o nota de voz) enviado por el técnico Alfredo Meléndez.
2. El técnico dictará los datos de campo EN CUALQUIER ORDEN, con lenguaje informal, pausado o con correcciones sobre la marcha.
3. Identifica contextualmente qué significa cada dato sin importar la secuencia en que lo mencione. Si se corrige durante el audio, toma únicamente la última versión.
4. Si un campo no es mencionado ni en el ticket ni en el dictado, escribe "N/A".

PLANTILLA DE SALIDA OBLIGATORIA (No agregues introducciones ni saludos):

Nro. de Ticket: [Extraer del ticket]

Nombre del Cliente: [Extraer del ticket]

Contrato: [Extraer del ticket]

Nap : [Extraer del dictado/texto]
Puerto : [Extraer del dictado/texto]
Marquilla : [Extraer del dictado/texto]

Marca de Onu : [Extraer del dictado/texto]
Modelo de Onu: [Extraer del dictado/texto]
Marca del router: [Extraer del dictado/texto]
Modelo del router: [Extraer del dictado/texto]

Observación🔎 [Extraer del ticket o dictado]

Falla🚨: [Extraer del dictado/texto]

Correctivos aplicados👷: [Extraer del dictado/texto]

Materiales⚒️:
[Extraer lista de materiales del dictado/texto]

IPTV📺: [Extraer del dictado/texto]

Potencias⚡️: [Extraer del dictado/texto o mantener la del ticket si no se indica otra]

Técnico: Alfredo Meléndez
`;

// Función para listar modelos disponibles en tus logs de Render
async function diagnosticarModelosDisponibles() {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    const data = await res.json();
    if (data.models) {
      console.log("📋 MODELOS DISPONIBLES EN TU CUENTA:");
      data.models.forEach(m => {
        if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
          console.log(`  - ${m.name}`);
        }
      });
    } else {
      console.error("❌ Respuesta al listar modelos:", JSON.stringify(data));
    }
  } catch (err) {
    console.error("❌ Error consultando modelos:", err.message);
  }
}

async function llamarGeminiREST(contentsPayload) {
  // Probamos con gemini-2.0-flash o gemini-2.5-flash
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contentsPayload,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('❌ Error API Gemini REST:', JSON.stringify(data));
    throw new Error(data.error?.message || 'Error en respuesta de Gemini');
  }

  const candidate = data.candidates && data.candidates[0];
  if (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) {
    return candidate.content.parts[0].text;
  }

  throw new Error("Respuesta de Gemini vacía o con formato no esperado.");
}

async function procesarMensaje(msg) {
  const chatId = msg.chat.id;

  try {
    if (msg.text) {
      bot.sendMessage(chatId, "⏳ Generando reporte...");
      historialChats[chatId] = msg.text;

      const payload = [{
        role: "user",
        parts: [{ text: `ENTRADA DEL TÉCNICO:\n${msg.text}` }]
      }];

      const respuestaTexto = await llamarGeminiREST(payload);
      bot.sendMessage(chatId, respuestaTexto);
    } 
    else if (msg.voice) {
      bot.sendMessage(chatId, "⏳ Procesando audio y generando reporte...");

      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const resAudio = await fetch(fileLink);
      const buffer = await resAudio.buffer();
      const base64Audio = buffer.toString('base64');

      const contextoPrevio = historialChats[chatId] ? `TICKET PREVIO RECIBIDO:\n${historialChats[chatId]}\n\n` : "";

      const payload = [{
        role: "user",
        parts: [
          { text: `${contextoPrevio}Procesa el siguiente audio de campo y genera la plantilla final.` },
          {
            inline_data: {
              mime_type: "audio/ogg",
              data: base64Audio
            }
          }
        ]
      }];

      const respuestaTexto = await llamarGeminiREST(payload);
      bot.sendMessage(chatId, respuestaTexto);
    }
  } catch (error) {
    console.error('❌ ERROR PROCESANDO MENSAJE:', error.message);
    bot.sendMessage(chatId, '❌ Hubo un error procesando la información. Inténtalo nuevamente.');
  }
}

app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  if (req.body && req.body.message) {
    procesarMensaje(req.body.message);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot activo con Webhook'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor activo en puerto ${PORT}`);
  
  // Ejecuta la verificación de modelos disponibles al iniciar
  diagnosticarModelosDisponibles();

  if (process.env.RENDER_EXTERNAL_URL) {
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook registrado con éxito en: ${webhookUrl}`);
    } catch (err) {
      console.error('❌ Error registrando Webhook:', err.message);
    }
  }
});
