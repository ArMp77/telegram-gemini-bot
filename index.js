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
1. REGLA DE DETECCIÓN DE CONTRATO (Contrato:): Extrae el número de contrato identificando el texto que comienza con el prefijo "CO-" en el ticket original (ejemplo: CO-00040140 - SAN FERNANDO). Aplica esta regla aunque la palabra "Contrato:" no figure expresamente etiquetada en el ticket.

2. REGLA DE EXTRACCIÓN Y LIMPIEZA DE NAP Y PUERTO:
   - Limpia y extrae ÚNICAMENTE el identificador/número útil, eliminando nombres de barrios, sectores, palabras como "Port".
   - Ejemplo 1: "Nap : 12", "Puerto : 14" -> Salida: Nap : 12 | Puerto : 14.
   - Ejemplo 2: "NAP_1058 BARRIO CRISTO REY (Port 6)" -> Salida: Nap : 1058 | Puerto : 06.
   - Si no figuran en el ticket, déjalos en blanco a la espera del audio/texto.

3. REGLA ESTRICTA DE MARQUILLA:
   - La Marquilla DEBE SER OBLIGATORIAMENTE un número de 5 o 6 dígitos (ejemplo: 043599 o 036713).
   - Si en el ticket o dictado NO aparece explícitamente un código numérico de 5 o 6 dígitos, DEJA EL CAMPO EN BLANCO. NUNCA inventes, asumas ni coloques datos que no cumplan con esta longitud de dígitos.

4. REGLA DE HARDWARE (ONU Y ROUTER):
   - Los campos: "Marca de Onu📶", "Modelo de Onu📶", "Marca del router🛜" y "Modelo del router🛜" NUNCA deben tomarse del ticket.
   - Déjalos COMPLETAMENTE EN BLANCO a menos que el técnico los mencione explícitamente en el dictado por audio/texto de campo. NUNCA inventes valores.

5. REGLA INVIOLABLE DE OBSERVACIÓN: El campo "Observación🔎" DEBE EXTRAERSE ÚNICAMENTE Y EXCLUSIVAMENTE del apartado "Tipo" presente en el ticket inicial. Ignora por completo cualquier otra observación, comentario o detalle dicho en el audio/texto del técnico para este campo.

6. REGLA DE REDACCIÓN TÉCNICA EN CORRECTIVOS (Correctivos aplicados👷): Transforma el dictado de esta sección a un lenguaje técnico y profesional de telecomunicaciones/FTTH (ej. "Fusión y empalme de fibra óptica", "Sustitución de conector mecánico/UPC", "Reemplazo de tramo de acometida").

7. NUNCA EXPLIQUES TU RAZONAMIENTO EN LA SALIDA. No agregues frases como "pero se menciona...", "se toma la última versión", ni explicaciones entre paréntesis. Entrega ÚNICAMENTE el dato final extraído.

8. Conserva los emoticonos exactamente como se muestran en la plantilla.

PLANTILLA DE SALIDA OBLIGATORIA (Mantiene los campos vacíos si no hay datos):

Nro. de Ticket📋: [Extraer del ticket]
Nombre del Cliente🆔: [Extraer del ticket]
Contrato📝: [Extraer del ticket buscando el texto que inicia con CO-]

Nap: [Solo el número/identificador limpio]
Puerto: [Solo el número limpio]
Marquilla: [Solo el número de 5 a 6 dígitos o dejar en blanco]

Marca de Onu📶: [Solo si se menciona en el audio/dictado]
Modelo de Onu📶: [Solo si se menciona en el audio/dictado]
Marca del router🛜: [Solo si se menciona en el audio/dictado]
Modelo del router🛜: [Solo si se menciona en el audio/dictado]

Observación🔎: [Extraer ÚNICAMENTE del campo "Tipo" del ticket original]

Falla🚨: [Extraer del dictado/texto]

Correctivos aplicados👷: [Extraer del dictado/texto formalizado técnicamente]

Materiales⚒️:
[Lista de materiales o N/A]

IPTV📺: [Extraer del dictado/texto]

Potencias⚡️: [Potencia dBm / Potencia dBm (distancia en metros con m final, ej: 5024m)]

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
        temperature: 0.0
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
