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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      door_events: {
        Row: {
          battery_level: number | null
          created_at: string
          device_serial: string
          door_status: string
          id: string
          signal_strength: number | null
          unit_id: string | null
        }
        Insert: {
          battery_level?: number | null
          created_at?: string
          device_serial: string
          door_status: string
          id?: string
          signal_strength?: number | null
          unit_id?: string | null
        }
        Update: {
          battery_level?: number | null
          created_at?: string
          device_serial?: string
          door_status?: string
          id?: string
          signal_strength?: number | null
          unit_id?: string | null
        }
        Relationships: []
      }
      lora_sensors: {
        Row: {
          app_key: string | null
          created_at: string | null
          dev_eui: string
          id: string
          join_eui: string | null
          name: string | null
          org_id: string
          sensor_kind: Database["public"]["Enums"]["sensor_kind"]
          site_id: string | null
          status: Database["public"]["Enums"]["sensor_status"] | null
          ttn_application_id: string | null
          ttn_device_id: string | null
          ttn_region: string | null
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          app_key?: string | null
          created_at?: string | null
          dev_eui: string
          id?: string
          join_eui?: string | null
          name?: string | null
          org_id: string
          sensor_kind?: Database["public"]["Enums"]["sensor_kind"]
          site_id?: string | null
          status?: Database["public"]["Enums"]["sensor_status"] | null
          ttn_application_id?: string | null
          ttn_device_id?: string | null
          ttn_region?: string | null
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          app_key?: string | null
          created_at?: string | null
          dev_eui?: string
          id?: string
          join_eui?: string | null
          name?: string | null
          org_id?: string
          sensor_kind?: Database["public"]["Enums"]["sensor_kind"]
          site_id?: string | null
          status?: Database["public"]["Enums"]["sensor_status"] | null
          ttn_application_id?: string | null
          ttn_device_id?: string | null
          ttn_region?: string | null
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      sensor_readings: {
        Row: {
          battery_level: number | null
          created_at: string
          device_serial: string
          humidity: number | null
          id: string
          reading_type: string | null
          signal_strength: number | null
          temperature: number | null
          unit_id: string | null
        }
        Insert: {
          battery_level?: number | null
          created_at?: string
          device_serial: string
          humidity?: number | null
          id?: string
          reading_type?: string | null
          signal_strength?: number | null
          temperature?: number | null
          unit_id?: string | null
        }
        Update: {
          battery_level?: number | null
          created_at?: string
          device_serial?: string
          humidity?: number | null
          id?: string
          reading_type?: string | null
          signal_strength?: number | null
          temperature?: number | null
          unit_id?: string | null
        }
        Relationships: []
      }
      sensor_uplinks: {
        Row: {
          battery_pct: number | null
          dev_eui: string
          f_port: number | null
          id: string
          org_id: string
          payload_json: Json | null
          received_at: string | null
          rssi_dbm: number | null
          snr_db: number | null
          unit_id: string | null
        }
        Insert: {
          battery_pct?: number | null
          dev_eui: string
          f_port?: number | null
          id?: string
          org_id: string
          payload_json?: Json | null
          received_at?: string | null
          rssi_dbm?: number | null
          snr_db?: number | null
          unit_id?: string | null
        }
        Update: {
          battery_pct?: number | null
          dev_eui?: string
          f_port?: number | null
          id?: string
          org_id?: string
          payload_json?: Json | null
          received_at?: string | null
          rssi_dbm?: number | null
          snr_db?: number | null
          unit_id?: string | null
        }
        Relationships: []
      }
      synced_users: {
        Row: {
          created_at: string
          default_site_id: string | null
          email: string
          full_name: string | null
          id: string
          last_updated_at: string
          source_organization_id: string
          source_site_id: string | null
          source_unit_id: string | null
          source_user_id: string
          synced_at: string
          ttn: Json | null
        }
        Insert: {
          created_at?: string
          default_site_id?: string | null
          email: string
          full_name?: string | null
          id?: string
          last_updated_at?: string
          source_organization_id: string
          source_site_id?: string | null
          source_unit_id?: string | null
          source_user_id: string
          synced_at?: string
          ttn?: Json | null
        }
        Update: {
          created_at?: string
          default_site_id?: string | null
          email?: string
          full_name?: string | null
          id?: string
          last_updated_at?: string
          source_organization_id?: string
          source_site_id?: string | null
          source_unit_id?: string | null
          source_user_id?: string
          synced_at?: string
          ttn?: Json | null
        }
        Relationships: []
      }
      ttn_settings: {
        Row: {
          api_key: string | null
          application_id: string | null
          cluster: string
          created_at: string
          enabled: boolean
          id: string
          last_test_at: string | null
          last_test_success: boolean | null
          org_id: string
          site_id: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          api_key?: string | null
          application_id?: string | null
          cluster?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_test_at?: string | null
          last_test_success?: boolean | null
          org_id: string
          site_id?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          api_key?: string | null
          application_id?: string | null
          cluster?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_test_at?: string | null
          last_test_success?: boolean | null
          org_id?: string
          site_id?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: []
      }
      unit_telemetry: {
        Row: {
          battery_pct: number | null
          critical_after_missed: number | null
          door_state: Database["public"]["Enums"]["door_state"] | null
          expected_checkin_minutes: number | null
          id: string
          last_door_event_at: string | null
          last_humidity: number | null
          last_temp_f: number | null
          last_uplink_at: string | null
          org_id: string
          rssi_dbm: number | null
          snr_db: number | null
          unit_id: string
          updated_at: string | null
          warn_after_missed: number | null
        }
        Insert: {
          battery_pct?: number | null
          critical_after_missed?: number | null
          door_state?: Database["public"]["Enums"]["door_state"] | null
          expected_checkin_minutes?: number | null
          id?: string
          last_door_event_at?: string | null
          last_humidity?: number | null
          last_temp_f?: number | null
          last_uplink_at?: string | null
          org_id: string
          rssi_dbm?: number | null
          snr_db?: number | null
          unit_id: string
          updated_at?: string | null
          warn_after_missed?: number | null
        }
        Update: {
          battery_pct?: number | null
          critical_after_missed?: number | null
          door_state?: Database["public"]["Enums"]["door_state"] | null
          expected_checkin_minutes?: number | null
          id?: string
          last_door_event_at?: string | null
          last_humidity?: number | null
          last_temp_f?: number | null
          last_uplink_at?: string | null
          org_id?: string
          rssi_dbm?: number | null
          snr_db?: number | null
          unit_id?: string
          updated_at?: string | null
          warn_after_missed?: number | null
        }
        Relationships: []
      }
      user_site_memberships: {
        Row: {
          created_at: string
          id: string
          is_default: boolean | null
          site_id: string
          site_name: string | null
          source_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          site_id: string
          site_name?: string | null
          source_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          site_id?: string
          site_name?: string | null
          source_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member"
      door_state: "open" | "closed" | "unknown"
      sensor_kind: "temp" | "door" | "combo"
      sensor_status: "pending" | "active" | "disabled"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "member"],
      door_state: ["open", "closed", "unknown"],
      sensor_kind: ["temp", "door", "combo"],
      sensor_status: ["pending", "active", "disabled"],
    },
  },
} as const
