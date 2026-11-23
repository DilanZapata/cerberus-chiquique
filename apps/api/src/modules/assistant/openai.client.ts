import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Mensaje del formato "chat completions" de OpenAI (solo lo que usa el asistente). */
export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const logger = new Logger('OpenAiClient');
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Una llamada a la API de OpenAI (chat completions con herramientas). La
 * llave y el modelo salen de las variables del servidor:
 *   OPENAI_API_KEY  (obligatoria)  llave de la cuenta de OpenAI de la empresa
 *   OPENAI_MODEL    (opcional)     modelo a usar
 *   OPENAI_BASE_URL (opcional)     solo para pruebas con un servidor simulado
 * La llave nunca sale del servidor: la app habla con Cerberus, no con OpenAI.
 */
export async function callOpenAi(messages: OpenAiMessage[], tools: OpenAiTool[]): Promise<OpenAiMessage> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableException('El asistente todavia no esta configurado: falta la llave de OpenAI en el servidor.');
  }
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
      signal: controller.signal,
    });
  } catch (error) {
    logger.error(`No se pudo conectar con OpenAI: ${(error as Error).message}`);
    throw new BadGatewayException('No se pudo conectar con el asistente. Intenta de nuevo en un momento.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.error(`OpenAI respondio ${response.status} (modelo ${model}): ${detail.slice(0, 500)}`);
    if (response.status === 401) throw new ServiceUnavailableException('La llave de OpenAI del servidor no es valida. Hay que revisarla.');
    if (response.status === 404 || /model/i.test(detail)) {
      throw new ServiceUnavailableException(`El modelo de OpenAI configurado ("${model}") no esta disponible para esta cuenta. Hay que ajustar OPENAI_MODEL en el servidor.`);
    }
    if (response.status === 429) throw new ServiceUnavailableException('La cuenta de OpenAI llego a su limite de uso o no tiene saldo. Intenta mas tarde.');
    throw new BadGatewayException('El asistente no pudo responder. Intenta de nuevo en un momento.');
  }

  const data = (await response.json()) as { choices?: Array<{ message?: OpenAiMessage }> };
  const message = data.choices?.[0]?.message;
  if (!message) throw new BadGatewayException('El asistente devolvio una respuesta vacia. Intenta de nuevo.');
  return { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls };
}
