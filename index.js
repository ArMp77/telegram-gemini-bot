const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fetch = require('node-fetch');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
  console.error("❌ Faltan las variables TELEGRAM_TOKEN o GROQ_API_KEY en Render.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const historialChats = {};

const SYSTEM_PROMPT = `
Eres un asistente técnico de telecomunicaciones para la empresa ThunderNet.

INSTRUCCIONES DE EXTRACCIÓN FLEXIBLE:
1. Recibirás un ticket de avería de fibra óptica en texto y/o el dictado enviado por el técnico Alfredo Meléndez.
2. El técnico dictará los datos de campo EN CUALQUIER ORDEN, con lenguaje informal o correcciones.
3. Toma únicamente la última versión si hay correcciones sobre la marcha.
4. Si un campo no se menciona, escribe "N/A".

PLANTILLA DE SALIDA OBLIGATORIA (Sin introducciones ni saludos):

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

async function procesarMensaje(msg) {
  const chatId = msg.chat.id;

  try {
    if (msg.text) {
      bot.sendMessage(chatId, "⏳ Generando reporte...");
      historialChats[chatId] = msg.text;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `ENTRADA DEL TÉCNICO:\n${msg.text}` }
        ],
        model: "llama-3.3-70b-versatile",
      });

      const respuesta = completion.choices[0]?.message?.content || "No se pudo generar respuesta.";
      bot.sendMessage(chatId, respuesta);
    } 
    else if (msg.voice) {
      bot.sendMessage(chatId, "⏳ Transcribiendo audio y generando reporte...");

      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const resAudio = await fetch(fileLink);
      const buffer = await resAudio.buffer();

      // Transcripción de audio ultra rápida con Whisper en Groq
      const transcription = await groq.audio.transcriptions.create({
        file: await Groq.toFile(buffer, "audio.ogg"),
        model: "whisper-large-v3",
        language: "es",
      });

      const textoAudio = transcription.text;
      const contextoPrevio = historialChats[chatId] ? `TICKET PREVIO RECIBIDO:\n${historialChats[chatId]}\n\n` : "";

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${contextoPrevio}DICTADO DE CAMPO TRANSCROTO:\n${textoAudio}` }
        ],
        model: "llama-3.3-70b-versatile",
      });

      const respuesta = completion.choices[0]?.message?.content || "No se pudo generar respuesta.";
      bot.sendMessage(chatId, respuesta);
    }
  } catch (error) {
    console.error('❌ ERROR PROCESANDO MENSAJE:', error);
    bot.sendMessage(chatId, '❌ Hubo un error procesando la información.');
  }
}

app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  if (req.body && req.body.message) {
    procesarMensaje(req.body.message);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot activo con Webhook (Groq Engine)'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor activo en puerto ${PORT}`);

  if (process.env.RENDER_EXTERNAL_URL) {
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/bot${TELEGRAM_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook registrado en: ${webhookUrl}`);
    } catch (err) {
      console.error('❌ Error registrando Webhook:', err.message);
    }
  }
});
