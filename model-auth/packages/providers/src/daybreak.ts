import type { ModelDescriptor } from "@model-auth/core";

export const OPENAI_CYBER_ACCESS_PROGRAMS = ["standard", "daybreak_blue", "daybreak_red"] as const;
export type OpenAICyberAccessProgram = typeof OPENAI_CYBER_ACCESS_PROGRAMS[number];

export interface OpenAIAccessPrograms {
  readonly cyber: readonly OpenAICyberAccessProgram[];
}

export function openAICyberAccessProgram(value: unknown): OpenAICyberAccessProgram | undefined {
  if (value === undefined) return undefined;
  if (!OPENAI_CYBER_ACCESS_PROGRAMS.includes(value as OpenAICyberAccessProgram)) throw new Error("Invalid OpenAI Cyber access program.");
  return value as OpenAICyberAccessProgram;
}

export function parseOpenAIAccessPrograms(value: unknown): OpenAIAccessPrograms | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const cyber = (value as Record<string, unknown>).cyber;
  if (!Array.isArray(cyber)) return undefined;
  return { cyber: OPENAI_CYBER_ACCESS_PROGRAMS.filter(program => cyber.includes(program)) };
}

/** Advertised programs take precedence; API catalog entries otherwise use documented model compatibility. */
export function openAIModelSupportsAccessProgram(
  model: Pick<ModelDescriptor, "id"> & { readonly availableAccessPrograms?: OpenAIAccessPrograms },
  program: OpenAICyberAccessProgram,
): boolean {
  openAICyberAccessProgram(program);
  if (model.availableAccessPrograms) return model.availableAccessPrograms.cyber.includes(program);
  const id = model.id.replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
  if (program === "daybreak_blue") return /^(gpt-6(?:\.1)?-sol|gpt-6-astra|gpt-daybreak-blue(?:-latest)?)$/.test(id);
  if (program === "daybreak_red") return /^(gpt-5\.6-cyber|gpt-daybreak-red(?:-latest)?)$/.test(id);
  return !/^gpt-(?:daybreak-|5\.6-cyber)/.test(id);
}

export function openAICyberRequestBody(payload: unknown, program: OpenAICyberAccessProgram): Record<string, unknown> {
  openAICyberAccessProgram(program);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("OpenAI request body must be an object.");
  const body = payload as Record<string, unknown>;
  const programs = body.access_programs;
  return { ...body, access_programs: { ...(programs && typeof programs === "object" && !Array.isArray(programs) ? programs : {}), cyber: program } };
}
