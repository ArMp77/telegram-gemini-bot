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
Eres un asistente técnico de telecomunicaciones para ThunderNet. Tu tarea es extraer la información del ticket y dictado de campo para rellenar una plantilla técnica.

REGLAS DE ORO:
1. NUNCA EXPLIQUES TU RAZONAMIENTO EN LA SALIDA. No agregues frases como "pero se menciona...", "se toma la última versión", ni explicaciones entre paréntesis. Entrega ÚNICAMENTE el dato final extraído.
2. Si el técnico da una corrección durante el dictado o el dato del dictado contradice al ticket, escribe ÚNICAMENTE la versión corregida final.
3. Conserva los emoticonos exactamente como se muestran en la plantilla.
4. Si un campo no es mencionado ni en el ticket ni en el dictado, escribe "N/A".

EJEMPLO DE COMPORTAMIENTO:
- Si el ticket dice "NAP 245" y el dictado dice "Perdón, corregido es NAP 252", la salida DEBE ser:
  Nap : NAP 252 (Omitiendo cualquier texto explicativo).

PLANTILLA DE SALIDA OBLIGATORIA (Copia exactamente esta estructura):

Nro. de Ticket: [Extraer del ticket]
Nombre del Cliente: [Extraer del ticket]
Contrato: [Extraer del ticket]

Nap : [Solo el valor final limpio de la NAP]
Puerto : [Solo el número/valor final limpio del puerto]
Marquilla : [Solo el valor limpio]

Marca de Onu : [Valor]
Modelo de Onu: [Valor]
Marca del router: [Valor]
Modelo del router: [Valor]

Observación🔎 : [Extraer del ticket o dictado]

Falla🚨 : [Extraer del dictado/texto]

Correctivos aplicados👷 : [Extraer del dictado/texto]

Materiales⚒️ :
[Lista de materiales o N/A]

IPTV📺 : [Extraer del dictado/texto]

Potencias⚡️ : [Potencia dBm / Potencia dBm (distancia en metros con m final, ej: 5024m)]

Técnicos: Equipo #04 Alfredo Meléndez/Alexis González
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
        temperature: 0.0 // Cero creatividad para forzar precisión absoluta
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
        temperature: 0.0
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
