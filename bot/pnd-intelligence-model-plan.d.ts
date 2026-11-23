export type PndIntelligenceModelPlan =
  | { type: "create_category"; name: string }
  | { type: "create_text_channel" | "create_voice_channel"; name: string; categoryName: string | null }
  | { type: "create_role"; name: string }
  | { type: "rename_channel"; channelId: string; name: string }
  | { type: "set_channel_topic"; channelId: string; topic: string }
  | { type: "set_channel_slowmode"; channelId: string; seconds: number }
  | { type: "send_announcement"; channelId: string; content: string }
  | { type: "none"; reason?: string };

export function parsePndIntelligenceModelPlan(raw: string): PndIntelligenceModelPlan;
