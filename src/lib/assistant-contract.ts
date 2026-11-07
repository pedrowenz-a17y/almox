export type AssistantMode = "local" | "openai";
export interface AssistantLink {
  label: string;
  href: string;
}
export interface AssistantReply {
  answer: string;
  scope: string;
  mode: AssistantMode;
  links?: AssistantLink[];
  suggestions?: string[];
  referenceQuestion?: string;
}
export interface AssistantProfile {
  mode: AssistantMode;
  label: string;
  description: string;
  configured: boolean;
  external: boolean;
}
