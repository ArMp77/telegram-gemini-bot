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

// MEMORIA TEMPORAL EN SERVIDOR
const historialChats = {};       // Guarda el ticket del cliente
const borradoresPendientes = {};  // Guarda el borrador generado antes de confirmar
const estadoEdicion = {};        // Guarda qué campo está corrigiendo el usuario

const VOCABULARIO_TELECOM = "ThunderNet, ONU LANLY, Mercusys, ZTE, Huawei, Fiberhome, TP-Link, G51S, MR30G, PTB, IPTV, dBm, NAP, fusionado, refusionar, acometida, potencia, sin evidencia fotográfica, sin fluido eléctrico, sin luz en la zona, tirrap, tirraps, roseta, conector APC, conector UPC, metros de fibra, bobina, patchcord.";

const SYSTEM_PROMPT = `
Eres un asistente técnico de telecomunicaciones para ThunderNet. Tu tarea es extraer la información del ticket y dictado de campo para rellenar una plantilla técnica con máxima precisión.

REGLAS DE ORO:
1. REGLA DE DETECCIÓN DE CONTRATO (Contrato:): Extrae el número de contrato identificando el texto que comienza con el prefijo "CO-" en el ticket original. (ejemplo: CO-00040140 - SAN FERNANDO). Aplica esta regla aunque la palabra "Contrato:" no figure expresamente etiquetada en el ticket.
2. REGLA DE HARDWARE (ONU Y ROUTER):
   - Los campos: "Marca de Onu📶", "Modelo de Onu📶", "Marca del router🛜" y "Modelo del router🛜" NUNCA deben tomarse del ticket.
   - Déjalos COMPLETAMENTE EN BLANCO a menos que el técnico los mencione explícitamente en el dictado por audio/texto de campo. NUNCA inventes valores.
3. REGLA DE EXTRACCIÓN Y LIMPIEZA DE NAP Y PUERTO:
   - Limpia y extrae ÚNICAMENTE el identificador/número útil, eliminando nombres de barrios, sectores, palabras como "Port".
   - Ejemplo 1: "Nap : 12", "Puerto : 14" -> Salida: Nap : 12 | Puerto : 14.
   - Ejemplo 2: "NAP_1058 BARRIO CRISTO REY (Port 6)" -> Salida: Nap : 1058 | Puerto : 06.
   - Si no figuran en el ticket, déjalos en blanco a la espera del audio/texto.
4. REGLA DE COMPLETITUD EN CAMPOS DE ESTADO (IPTV📺): Incluye novedades operativas completas (ej. "activo pero sin luz en la zona").
5. REGLA ESTRICTA DE MARQUILLA:
   - La Marquilla DEBE SER OBLIGATORIAMENTE un número de 5 o 6 dígitos (ejemplo: 043599 o 036713).
   - Si en el ticket o dictado NO aparece explícitamente un código numérico de 5 o 6 dígitos, DEJA EL CAMPO EN BLANCO. NUNCA inventes, asumas ni coloques datos que no cumplan con esta longitud de dígitos.
6. REGLA INVIOLABLE DE OBSERVACIÓN: El campo "Observación🔎" DEBE EXTRAERSE ÚNICAMENTE Y EXCLUSIVAMENTE del apartado "Tipo" presente en el ticket inicial. Ignora por completo cualquier otra observación, comentario o detalle dicho en el audio/texto del técnico para este campo.
7. REGLA DE REDACCIÓN TÉCNICA EN CORRECTIVOS (Correctivos aplicados👷): Transforma el dictado de esta sección a un lenguaje técnico y profesional de telecomunicaciones/FTTH (ej. "Fusión y empalme de fibra óptica", "Sustitución de conector mecánico/UPC", "Reemplazo de tramo de acometida").
8. REGLA ESTRICTA DE FORMATO DE MATERIALES (Materiales⚒️):
   - Cada material dictado DEBE ir en una línea individual (separado por saltos de línea).
   - NUNCA escribas números en palabras (ej. escribe "01" en lugar de "un" o "uno", y "04" en lugar de "cuatro").
   - Para cantidades enteras menores a 10, antepone un cero (ejemplo: "01 conector APC", "04 tirrap medianos"). Para metrajes o cantidades de 10 o más, usa el número estándar (ejemplo: "325 metros de fibra").
   - Escribe en minúsculas y estandariza nombres de insumos (ejemplo: "tirrap" o "tirraps" en lugar de "tiras").
   - Si no se usaron materiales, escribe únicamente "N/A".
9. NUNCA EXPLIQUES TU RAZONAMIENTO EN LA SALIDA.
10. Conserva los emoticonos exactamente como se muestran en la plantilla.


PLANTILLA DE SALIDA OBLIGATORIA:

Nro. de Ticket📋: [Extraer del ticket]
Nombre del Cliente🆔: [Extraer del ticket]
Contrato📝: [Extraer del ticket buscando el texto que inicia con CO-]

Nap: [Solo el número/identificador limpio]
Puerto: [Solo el número limpio]
Marquilla: [Solo el número de 5 a 6 dígitos o dejar en blanco]

Marca de Onu📶: [Valor dictado]
Modelo de Onu📶: [Valor dictado]
Marca del router🛜: [Valor dictado]
Modelo del router🛜: [Valor dictado]

Observación🔎 : [Extraer ÚNICAMENTE del campo "Tipo" del ticket original]

Falla🚨: [Extraer del dictado/texto]

Correctivos aplicados👷: [Extraer del dictado/texto formalizado técnicamente]

Materiales⚒️:
[Lista cada material en su propia línea siguiendo la Regla 8]

IPTV📺: [Extraer del dictado/texto con novedades si existen]

Potencias⚡️: [Potencia dBm / Potencia dBm (distancia en metros con m final, ej: 5024m)]

Técnicos: Equipo #04 Alfredo Meléndez/Alexis González
`;

// FUNCIONES AUXILIARES DE TECLADO INTERACTIVO
function obtenerBotoneraPrincipal() {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirmar Reporte", callback_data: "confirmar_reporte" },
        { text: "✏️ Modificar Campo", callback_data: "menu_edicion" }
      ],
      [
        { text: "❌ Cancelar", callback_data: "cancelar_borrador" }
      ]
    ]
  };
}

function obtenerBotoneraCampos() {
  return {
    inline_keyboard: [
      [
        { text: "Nap / Puerto", callback_data: "edit_nap_puerto" },
        { text: "Potencias ⚡️", callback_data: "edit_potencias" }
      ],
      [
        { text: "ONU / Router 🛜", callback_data: "edit_hardware" },
        { text: "Falla / Correctivos 👷", callback_data: "edit_correctivos" }
      ],
      [
        { text: "⬅️ Volver", callback_data: "volver_principal" }
      ]
    ]
  };
}

async function procesarMensaje(msg) {
  const chatId = msg.chat.id;
  const textoEntrante = msg.text ? msg.text.trim() : "";

  // 1. MANEJO DE COMANDOS DE ESTADO (/nuevo y /cancelar)
  if (textoEntrante === "/nuevo" || textoEntrante === "/cancelar") {
    delete historialChats[chatId];
    delete borradoresPendientes[chatId];
    delete estadoEdicion[chatId];
    bot.sendMessage(chatId, "🧹 *Memoria limpiada con éxito.* Puedes enviar el ticket del nuevo cliente.", { parse_mode: "Markdown" });
    return;
  }

  // 2. SI EL USUARIO ESTÁ EN MODO DE EDICIÓN DE UN CAMPO ESPECÍFICO
  if (estadoEdicion[chatId]) {
    const campoAEditar = estadoEdicion[chatId];
    delete estadoEdicion[chatId]; // Salir del modo edición

    bot.sendMessage(chatId, `⏳ Aplicando corrección en *${campoAEditar}*...`, { parse_mode: "Markdown" });

    let nuevoDato = textoEntrante;
    if (msg.voice) {
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const resAudio = await fetch(fileLink);
      const buffer = await resAudio.buffer();
      const transcription = await groq.audio.transcriptions.create({
        file: await Groq.toFile(buffer, "audio.ogg"),
        model: "whisper-large-v3",
        language: "es",
        prompt: VOCABULARIO_TELECOM,
        temperature: 0.0
      });
      nuevoDato = transcription.text;
    }

    // Pedir a Llama que reemplace solo esa sección dentro del borrador actual
    const borradorPrevio = borradoresPendientes[chatId];
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Eres un editor técnico. Reemplaza ÚNICAMENTE el campo especificado dentro del reporte manteniedo la estructura exacta de la plantilla." },
        { role: "user", content: `REPORTE ACTUAL:\n${borradorPrevio}\n\nSECCIÓN A CAMBIAR: ${campoAEditar}\nNUEVO VALOR DICTADO: ${nuevoDato}` }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.0
    });

    const borradorActualizado = completion.choices[0]?.message?.content || borradorPrevio;
    borradoresPendientes[chatId] = borradorActualizado;

    bot.sendMessage(chatId, `📝 *VISTA PREVIA ACTUALIZADA*\n\n${borradorActualizado}`, {
      parse_mode: "Markdown",
      reply_markup: obtenerBotoneraPrincipal()
    });
    return;
  }

  // 3. FLUTO CONVENCIONAL DE RECEPCIÓN (TICKET O AUDIO DE CAMPO)
  try {
    if (msg.text) {
      bot.sendMessage(chatId, "⏳ Guardando ticket y generando borrador...");
      historialChats[chatId] = msg.text;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `ENTRADA DEL TÉCNICO:\n${msg.text}` }
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.0
      });

      const borrador = completion.choices[0]?.message?.content || "Error generando el borrador.";
      borradoresPendientes[chatId] = borrador;

      bot.sendMessage(chatId, `📝 *BORRADOR DE REPORTE*\n\n${borrador}`, {
        parse_mode: "Markdown",
        reply_markup: obtenerBotoneraPrincipal()
      });
    } 
    else if (msg.voice) {
      bot.sendMessage(chatId, "⏳ Transcribiendo audio de campo y generando borrador...");

      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const resAudio = await fetch(fileLink);
      const buffer = await resAudio.buffer();

      const transcription = await groq.audio.transcriptions.create({
        file: await Groq.toFile(buffer, "audio.ogg"),
        model: "whisper-large-v3",
        language: "es",
        prompt: VOCABULARIO_TELECOM,
        temperature: 0.0
      });

      const textoAudio = transcription.text;
      const contextoPrevio = historialChats[chatId] ? `TICKET PREVIO RECIBIDO:\n${historialChats[chatId]}\n\n` : "";

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${contextoPrevio}DICTADO DE CAMPO TRANSCITO:\n${textoAudio}` }
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.0
      });

      const borrador = completion.choices[0]?.message?.content || "Error generando el borrador.";
      borradoresPendientes[chatId] = borrador;

      bot.sendMessage(chatId, `📝 *BORRADOR DE REPORTE*\n\n${borrador}`, {
        parse_mode: "Markdown",
        reply_markup: obtenerBotoneraPrincipal()
      });
    }
  } catch (error) {
    console.error('❌ ERROR PROCESANDO MENSAJE:', error);
    bot.sendMessage(chatId, '❌ Hubo un error procesando la información.');
  }
}

// 4. MANEJO DE EVENTOS DE BOTONES (CALLBACK QUERIES)
async function procesarCallbackQuery(callbackQuery) {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const data = callbackQuery.data;

  // Confirmación al cliente de la pulsación del botón
  bot.answerCallbackQuery(callbackQuery.id);

  if (data === "confirmar_reporte") {
    const borradorFinal = borradoresPendientes[chatId];
    if (!borradorFinal) {
      bot.sendMessage(chatId, "❌ No hay un borrador activo para confirmar.");
      return;
    }

    // Editar mensaje para eliminar los botones y entregar la versión definitiva
    bot.editMessageText(`📋 *REPORTE TÉCNICO OFICIAL*\n\n\`\`\`\n${borradorFinal}\n\`\`\``, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown"
    });

    bot.sendMessage(chatId, "✅ *Reporte listo para copiar o reenviar.* Puedes usar /nuevo para iniciar otro ticket.");
    delete borradoresPendientes[chatId];
  } 
  else if (data === "menu_edicion") {
    bot.editMessageReplyMarkup(obtenerBotoneraCampos(), {
      chat_id: chatId,
      message_id: messageId
    });
  } 
  else if (data === "volver_principal") {
    bot.editMessageReplyMarkup(obtenerBotoneraPrincipal(), {
      chat_id: chatId,
      message_id: messageId
    });
  } 
  else if (data === "cancelar_borrador") {
    delete borradoresPendientes[chatId];
    bot.editMessageText("❌ *Borrador descartado.*", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown"
    });
  } 
  // SELECCIÓN DE CAMPOS INDIVIDUALES A EDITAR
  else if (data.startsWith("edit_")) {
    const nombresCampos = {
      edit_nap_puerto: "NAP y Puerto",
      edit_potencias: "Potencias⚡️",
      edit_hardware: "Marca/Modelo ONU o Router",
      edit_correctivos: "Falla y Correctivos aplicados"
    };

    const campoSeleccionado = nombresCampos[data] || "el campo elegido";
    estadoEdicion[chatId] = campoSeleccionado;

    bot.sendMessage(chatId, `✍️ *Modo edición activado:* Envía por texto o voz la corrección para *${campoSeleccionado}*.`, {
      parse_mode: "Markdown"
    });
  }
}

// RUTAS DE WEBHOOK
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  if (req.body) {
    if (req.body.message) {
      procesarMensaje(req.body.message);
    } else if (req.body.callback_query) {
      procesarCallbackQuery(req.body.callback_query);
    }
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot interactivo activo (Groq Engine)'));

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
