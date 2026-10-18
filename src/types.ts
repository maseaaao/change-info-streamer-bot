export interface TwitchCategory {
  id: string;
  name: string;
  imageUrl: string;
}

export interface TwitchState {
  connected: boolean;
  live: boolean;
  accountName?: string;
  login?: string;
  broadcasterId?: string;
  title?: string;
  categoryId?: string;
  categoryName?: string;
  categoryImageUrl?: string;
  tags?: string[];
}

export interface StreamState {
  apiVersion: number;
  twitch: TwitchState;
  templates: TemplateState;
}

export interface TemplateState {
  twitchTemplate: string;
  subtitle: string;
  configured: boolean;
}

export interface ActionResponse {
  apiVersion: number;
  requestId: string;
  command: string;
  ok: boolean;
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

export interface ConnectionSettings {
  host: string;
  port: number;
  endpoint: string;
  password: string;
  rememberPassword: boolean;
  twitchTemplate: string;
  lastSubtitle: string;
  twitchEnabled: boolean;
}

export interface ActionSummary {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
}

export type Platform = "twitch";

export interface AllForm {
  twitchTitle: string;
  twitchTitleMode: "subtitle" | "full";
  subtitle: string;
  twitchCategory: TwitchCategory | null;
  twitchTags: string[];
  twitchTagDraft: string;
  twitchCategoryQuery: string;
}
