import { BadGatewayException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Una herramienta que el modelo puede pedir (el servidor de Cerberus es quien la ejecuta). */
export interface AssistantTool {
  name: string;
  description: string;
  /** Esquema JSON de los argumentos. */
  parameters: Record<string, unknown>;
}

export interface AssistantTurnInput {
  /** Instrucciones del sistema (quien es el asistente, reglas). */
  system: string;
  /** La conversacion hasta ahora; el ultimo mensaje es del usuario. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: AssistantTool[];
  /** Ejecuta una herramienta y devuelve su resultado como texto (JSON). */
  runTool: (name: string, rawArguments: string) => Promise<string>;
  /** Vueltas maximas de "el modelo pide herramientas -> se le responde". */
  maxRounds: number;
}

const logger = new Logger('OpenAiClient');
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = 'gpt-5.6-terra';

interface OpenAiSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Error de OpenAI con su codigo HTTP y su mensaje, para decidir si se reintenta por la otra via. */
class OpenAiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`OpenAI ${status}: ${detail}`);
  }
}

function settings(): OpenAiSettings {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableException('El asistente todavia no esta configurado: falta la llave de OpenAI en el servidor.');
  }
  return {
    apiKey,
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

async function post(config: OpenAiSettings, path: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    logger.error(`No se pudo conectar con OpenAI (${path}): ${(error as Error).message}`);
    throw new BadGatewayException('No se pudo conectar con el asistente. Intenta de nuevo en un momento.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text.slice(0, 400);
    try {
      detail = String(JSON.parse(text)?.error?.message ?? detail).slice(0, 400);
    } catch {
      // el cuerpo no era JSON: se deja el texto tal cual
    }
    logger.error(`OpenAI respondio ${response.status} en ${path} (modelo ${config.model}): ${detail}`);
    throw new OpenAiHttpError(response.status, detail);
  }
  return response.json();
}

/** Convierte un error de OpenAI en un mensaje que la persona entienda, con el detalle tecnico para poder arreglarlo. */
function explain(error: OpenAiHttpError, config: OpenAiSettings): HttpException {
  const detail = error.detail ? ` Detalle de OpenAI: ${error.detail}` : '';
  if (error.status === 401) return new ServiceUnavailableException('La llave de OpenAI del servidor no es valida. Hay que revisarla.');
  if (error.status === 429) {
    return new ServiceUnavailableException(`La cuenta de OpenAI llego a su limite de uso o no tiene saldo.${detail}`);
  }
  if (error.status === 404 || /model/i.test(error.detail)) {
    return new ServiceUnavailableException(
      `El modelo de OpenAI configurado ("${config.model}") no esta disponible para esta cuenta. Hay que ajustar OPENAI_MODEL en el servidor.${detail}`,
    );
  }
  return new BadGatewayException(`OpenAI rechazo la solicitud (codigo ${error.status}).${detail}`);
}

// ------------------------------------------------------------ Responses API

/**
 * Via principal: la "Responses API" (/v1/responses). Es la que OpenAI exige
 * para usar herramientas con sus modelos nuevos (por /chat/completions las
 * rechazan). Se usa sin guardar nada en OpenAI (`store: false`): en cada
 * vuelta se le reenvia todo lo que el modelo ya produjo (incluido su
 * razonamiento, que viaja cifrado).
 */
async function runWithResponses(config: OpenAiSettings, turn: AssistantTurnInput): Promise<string> {
  const tools = turn.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }));
  const input: unknown[] = turn.history.map((message) => ({ role: message.role, content: message.content }));

  for (let round = 0; round < turn.maxRounds; round++) {
    const data = await post(config, '/responses', {
      model: config.model,
      instructions: turn.system,
      input,
      tools,
      tool_choice: 'auto',
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    const output: any[] = Array.isArray(data?.output) ? data.output : [];
    const calls = output.filter((item) => item?.type === 'function_call');
    if (calls.length === 0) {
      const text = output
        .filter((item) => item?.type === 'message')
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('\n')
        .trim();
      return text || (typeof data?.output_text === 'string' ? data.output_text.trim() : '');
    }
    input.push(...output);
    for (const call of calls) {
      input.push({ type: 'function_call_output', call_id: call.call_id, output: await turn.runTool(String(call.name), String(call.arguments ?? '{}')) });
    }
  }
  return '';
}

// ------------------------------------------------------ Chat Completions API

/**
 * Via alterna: /v1/chat/completions, para cuentas o modelos donde la
 * Responses API no este disponible. Si el modelo rechaza las herramientas
 * por tener razonamiento activo, se reintenta pidiendole que no razone.
 */
async function runWithChatCompletions(config: OpenAiSettings, turn: AssistantTurnInput): Promise<string> {
  const tools = turn.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  const messages: any[] = [{ role: 'system', content: turn.system }, ...turn.history];
  let extra: Record<string, unknown> = {};

  for (let round = 0; round < turn.maxRounds; round++) {
    let data: any;
    try {
      data = await post(config, '/chat/completions', { model: config.model, messages, tools, tool_choice: 'auto', ...extra });
    } catch (error) {
      const canRetry = error instanceof OpenAiHttpError && error.status === 400 && /reasoning/i.test(error.detail) && !('reasoning_effort' in extra);
      if (!canRetry) throw error;
      extra = { reasoning_effort: 'none' };
      data = await post(config, '/chat/completions', { model: config.model, messages, tools, tool_choice: 'auto', ...extra });
    }
    const message = data?.choices?.[0]?.message;
    if (!message) return '';
    const calls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) return String(message.content ?? '').trim();
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      messages.push({ role: 'tool', tool_call_id: call.id, content: await turn.runTool(String(call.function?.name), String(call.function?.arguments ?? '{}')) });
    }
  }
  return '';
}

/**
 * Un turno del asistente: le pasa la conversacion al modelo de OpenAI, le
 * ejecuta las herramientas que pida y devuelve su respuesta final en texto.
 *
 * Variables del servidor:
 *   OPENAI_API_KEY   (obligatoria) llave de la cuenta de OpenAI de la empresa
 *   OPENAI_MODEL     (opcional)    modelo a usar
 *   OPENAI_API_MODE  (opcional)    "responses" o "chat" para forzar una via;
 *                                  sin valor, prueba Responses y si esa via
 *                                  no existe para la cuenta/modelo, usa chat
 *   OPENAI_BASE_URL  (opcional)    solo para pruebas con un servidor simulado
 * La llave nunca sale del servidor: la app habla con Cerberus, no con OpenAI.
 */
export async function runAssistantTurn(turn: AssistantTurnInput): Promise<string> {
  const config = settings();
  const mode = (process.env.OPENAI_API_MODE || '').toLowerCase();
  try {
    if (mode === 'chat') return await runWithChatCompletions(config, turn);
    try {
      return await runWithResponses(config, turn);
    } catch (error) {
      // Solo se cambia de via si Responses no existe o no acepta la solicitud
      // (404/400); una llave mala o falta de saldo fallaria igual por la otra.
      const responsesUnavailable = error instanceof OpenAiHttpError && (error.status === 404 || error.status === 400 || error.status === 405);
      if (mode === 'responses' || !responsesUnavailable) throw error;
      logger.warn(`La Responses API no acepto la solicitud (${(error as OpenAiHttpError).status}); se intenta por chat/completions.`);
      try {
        return await runWithChatCompletions(config, turn);
      } catch (fallbackError) {
        // Si la via alterna tampoco sirve, el error util es el de la via principal.
        if (fallbackError instanceof OpenAiHttpError && fallbackError.status !== 401 && fallbackError.status !== 429) throw error;
        throw fallbackError;
      }
    }
  } catch (error) {
    if (error instanceof OpenAiHttpError) throw explain(error, config);
    throw error;
  }
}
