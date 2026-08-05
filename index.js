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
Eres un asistente técnico de telecomunicaciones para la empresa ThunderNet. Tu tarea es extraer la información de las notas/tickets y dictados de campo para generar un reporte con formato estricto.

REGLAS DE EXTRACCIÓN Y FORMATO:
1. MANTÉN LOS EMOTICONOS E ÍCONOS EXACTAMENTE COMO SE INDICAN EN LA PLANTILLA. NO LOS ELIMINES NI MODIFIQUES.
2. REGLA PARA NAP Y PUERTO: Extrae ÚNICAMENTE del dictado/texto.
3. Si un campo no se menciona ni en el ticket ni en el dictado, escribe "N/A".
4. Si el técnico corrige un dato durante el audio/texto, toma únicamente la última versión dictada.

PLANTILLA DE SALIDA OBLIGATORIA (Copia los nombres de campos e íconos exactamente como están aquí, sin agregar introducciones ni saludos):

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

Potencias⚡️: [Extraer del dictado/texto y añade la distancia que indica en el dictado con la letra m al final y entre parentesis los numeros. Ejemplo (3682m)]

Técnicos: Equipo #04 Alfredo Melendez/Alexis González 

----------------
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
        temperature: 0.1
      });

      const respuesta = completion.choices[0]?.message?.content || "No se pudo generar respuesta.";
      bot.sendMessage(chatId, respuesta);
    } 
    else if (msg.voice) {
      bot.sendMessage(chatId, "⏳ Transcribiendo audio y generando reporte...");

      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const resAudio = await fetch(fileLink);
      const buffer = await resAudio.buffer();

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
          { role: "user", content: `${contextoPrevio}DICTADO DE CAMPO TRANCRITO:\n${textoAudio}` }
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.1
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
