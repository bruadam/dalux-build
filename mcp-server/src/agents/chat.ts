/** The model side of a hosted agent run: Mistral chat with tool calling, behind a small interface the tests replace. */

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  /** Upper bound for the reply; the run's remaining token budget. */
  maxTokens: number;
  timeoutMs: number;
}

export interface ChatReply {
  content: string;
  toolCalls: ToolCall[];
  tokens: number;
}

export interface ChatClient {
  complete(request: ChatRequest): Promise<ChatReply>;
}

export type ChatClientFactory = (apiKey: string) => ChatClient;

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const mistralChat: ChatClientFactory = (apiKey) => ({
  async complete(request) {
    const { Mistral } = await import('@mistralai/mistralai');
    const client = new Mistral({ apiKey });
    const response = await client.chat.complete(
      {
        model: request.model,
        temperature: 0.2,
        maxTokens: request.maxTokens,
        toolChoice: 'auto',
        tools: request.tools.map((tool) => ({ type: 'function' as const, function: tool })),
        messages: request.messages.map((message) => {
          if (message.role === 'assistant') {
            return {
              role: 'assistant' as const,
              content: message.content,
              toolCalls: message.toolCalls?.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            };
          }
          return message;
        }),
      },
      { timeoutMs: request.timeoutMs },
    );
    const message = response.choices?.[0]?.message;
    const content = message?.content;
    return {
      content: typeof content === 'string' ? content : (content ?? []).map((part) => ('text' in part ? part.text : '')).join(''),
      toolCalls: (message?.toolCalls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      })),
      tokens: response.usage?.totalTokens ?? 0,
    };
  },
});
