import { toGeminiSchema } from '@cortexkit/antigravity-auth-core'
import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  TextContent,
  Tool,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai'


type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | {
      functionCall: { name: string; args: Record<string, unknown>; id: string }
      thoughtSignature?: string
    }
  | {
      functionResponse: {
        name: string
        response: Record<string, unknown>
        id: string
        parts?: Array<{ inlineData: { mimeType: string; data: string } }>
      }
    }

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string
    description: string
    parameters?: unknown
  }>
}

export interface GeminiRequest {
  contents: GeminiContent[]
  tools?: GeminiTool[]
  systemInstruction?: { parts: GeminiPart[] }
}

function sanitize(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
}

function convertUserParts(
  content: Array<TextContent | ImageContent>,
): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const item of content) {
    if (item.type === 'text') {
      if (item.text) parts.push({ text: sanitize(item.text) })
    } else if (item.type === 'image' && item.data) {
      parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } })
    }
  }
  return parts
}

function convertAssistantParts(
  message: AssistantMessage,
  preserveSignedHistory: boolean,
): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const block of message.content) {
    if (block.type === 'thinking') {
      if (preserveSignedHistory && block.thinking) {
        parts.push({
          text: sanitize(block.thinking),
          thought: true,
          ...(block.thinkingSignature
            ? { thoughtSignature: block.thinkingSignature }
            : {}),
        })
      }
    } else if (block.type === 'text' && block.text.trim()) {
      parts.push({
        text: sanitize(block.text),
        ...(preserveSignedHistory && block.textSignature
          ? { thoughtSignature: block.textSignature }
          : {}),
      })
    } else if (block.type === 'toolCall') {
      parts.push({
        functionCall: {
          name: block.name,
          args: (block.arguments ?? {}) as Record<string, unknown>,
          id: block.id,
        },
        ...(preserveSignedHistory && block.thoughtSignature
          ? { thoughtSignature: block.thoughtSignature }
          : {}),
      })
    }
  }
  return parts
}

function toolResultResponse(
  message: ToolResultMessage,
): Record<string, unknown> {
  const text = message.content
    .filter((item): item is TextContent => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
  if (message.isError) {
    return { error: text || 'Error' }
  }
  return { output: text }
}

export interface BuildGeminiRequestOptions {
  provider?: string
  model?: string
}

function isSameTargetModel(
  message: AssistantMessage,
  options: BuildGeminiRequestOptions | undefined,
): boolean {
  if (!options?.provider || !options.model) return true
  return (
    message.provider === options.provider && message.model === options.model
  )
}

function convertMessages(
  messages: Message[],
  options?: BuildGeminiRequestOptions,
): GeminiContent[] {
  const contents: GeminiContent[] = []
  for (const message of messages) {
    if (!message) continue
    if (message.role === 'system') continue

    if (message.role === 'user') {
      const parts =
        typeof message.content === 'string'
          ? message.content.trim()
            ? [{ text: sanitize(message.content) }]
            : []
          : convertUserParts(
              message.content as Array<TextContent | ImageContent>,
            )
      if (parts.length) contents.push({ role: 'user', parts })
      continue
    }

    if (message.role === 'assistant') {
      const parts = convertAssistantParts(
        message,
        isSameTargetModel(message, options),
      )
      if (parts.length) contents.push({ role: 'model', parts })
      continue
    }

    if (message.role === 'toolResult') {
      const role = 'user'
      const part: GeminiPart = {
        functionResponse: {
          name: message.toolName,
          response: toolResultResponse(message),
          id: message.toolCallId,
          ...(message.content.some(item => item.type === 'image') ? { parts: message.content.filter((item): item is ImageContent => item.type === 'image').map(item => ({ inlineData: { mimeType: item.mimeType, data: item.data } })) } : {}),
        },
      }
      const last = contents[contents.length - 1]
      if (
        last &&
        last.role === role &&
        last.parts.every((p) => 'functionResponse' in p)
      ) {
        last.parts.push(part)
      } else {
        contents.push({ role, parts: [part] })
      }
    }
  }

  return contents
}

function convertTools(
  tools: Tool[] | undefined,
  model?: string,
): GeminiTool[] | undefined {
  if (!tools?.length) return undefined
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiSchema(tool.parameters, {
          moveNumericConstraintsToDescription: model
            ?.replace(/^antigravity-/, '')
            .startsWith('gpt-oss-') ?? false,
        }),
      })),
    },
  ]
}

interface InstructionState {
  systemPrompt: string
  tools: Tool[]
}


function resolveInstructionState(context: Context): InstructionState {
  return { systemPrompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages) }
}


export function buildGeminiRequest(
  context: Context,
  options?: BuildGeminiRequestOptions,
): GeminiRequest {
  const request: GeminiRequest = {
    contents: convertMessages(context.messages, options),
  }

  const { systemPrompt, tools } = resolveInstructionState(context)

  const geminiTools = convertTools(tools, options?.model)
  if (geminiTools) request.tools = geminiTools

  if (systemPrompt.trim()) {
    request.systemInstruction = {
      parts: [{ text: sanitize(systemPrompt) }],
    }
  }

  return request
}
