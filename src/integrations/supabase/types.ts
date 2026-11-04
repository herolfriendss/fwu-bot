export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      sysplus_audit_log: {
        Row: {
          id: number
          guild_id: string
          actor_id: string
          action: string
          target_id: string | null
          details: Json
          created_at: string
        }
        Insert: {
          id?: never
          guild_id: string
          actor_id: string
          action: string
          target_id?: string | null
          details?: Json
          created_at?: string
        }
        Update: {
          id?: never
          guild_id?: string
          actor_id?: string
          action?: string
          target_id?: string | null
          details?: Json
          created_at?: string
        }
        Relationships: []
      }
      bot_economy_snapshots: {
        Row: {
          active_games: number
          captured_at: string
          daily_claims: number
          guild_id: string
          guild_name: string | null
          ledger_count: number
          shop_items: Json
          top_wallets: Json
          total_balance: number
          updated_at: string
          wallet_count: number
        }
        Insert: {
          active_games?: number
          captured_at?: string
          daily_claims?: number
          guild_id: string
          guild_name?: string | null
          ledger_count?: number
          shop_items?: Json
          top_wallets?: Json
          total_balance?: number
          updated_at?: string
          wallet_count?: number
        }
        Update: {
          active_games?: number
          captured_at?: string
          daily_claims?: number
          guild_id?: string
          guild_name?: string | null
          ledger_count?: number
          shop_items?: Json
          top_wallets?: Json
          total_balance?: number
          updated_at?: string
          wallet_count?: number
        }
        Relationships: []
      }
      bot_runtime_status: {
        Row: {
          connected: boolean
          events: Json
          guilds: Json
          id: string
          last_seen: string
          last_sync: string | null
          started_at: string
        }
        Insert: {
          connected?: boolean
          events?: Json
          guilds?: Json
          id: string
          last_seen?: string
          last_sync?: string | null
          started_at: string
        }
        Update: {
          connected?: boolean
          events?: Json
          guilds?: Json
          id?: string
          last_seen?: string
          last_sync?: string | null
          started_at?: string
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          guild_id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          guild_id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          guild_id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      discord_custom_commands: {
        Row: {
          application_id: string
          command_id: string
          description: string
          ephemeral: boolean
          name: string
          permission: string
          response: string
        }
        Insert: {
          application_id: string
          command_id: string
          description: string
          ephemeral?: boolean
          name: string
          permission?: string
          response: string
        }
        Update: {
          application_id?: string
          command_id?: string
          description?: string
          ephemeral?: boolean
          name?: string
          permission?: string
          response?: string
        }
        Relationships: []
      }
      discord_interaction_receipts: {
        Row: { interaction_id: string; created_at: string }
        Insert: { interaction_id: string; created_at?: string }
        Update: { interaction_id?: string; created_at?: string }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
