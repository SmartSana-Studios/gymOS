export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attendance_events: {
        Row: {
          checked_in_at: string
          checked_out_at: string | null
          checkout_type: string | null
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        Insert: {
          checked_in_at?: string
          checked_out_at?: string | null
          checkout_type?: string | null
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
        }
        Update: {
          checked_in_at?: string
          checked_out_at?: string | null
          checkout_type?: string | null
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_events_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action_type: string
          actor_display_name: string
          actor_id: string | null
          created_at: string
          gym_id: string | null
          id: string
          metadata: Json
          target_entity_id: string | null
          target_entity_type: string | null
        }
        Insert: {
          action_type: string
          actor_display_name: string
          actor_id?: string | null
          created_at?: string
          gym_id?: string | null
          id?: string
          metadata?: Json
          target_entity_id?: string | null
          target_entity_type?: string | null
        }
        Update: {
          action_type?: string
          actor_display_name?: string
          actor_id?: string | null
          created_at?: string
          gym_id?: string | null
          id?: string
          metadata?: Json
          target_entity_id?: string | null
          target_entity_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gyms: {
        Row: {
          alert_auto_dismiss_minutes: number
          capacity: number | null
          created_at: string
          default_language: string
          grace_period_days: number
          gym_token: string
          id: string
          logo_url: string | null
          member_cap_override: number | null
          name: string
          primary_color: string | null
          status: Database["public"]["Enums"]["gym_status"]
          tier_id: string
          timezone: string
        }
        Insert: {
          alert_auto_dismiss_minutes?: number
          capacity?: number | null
          created_at?: string
          default_language?: string
          grace_period_days?: number
          gym_token?: string
          id?: string
          logo_url?: string | null
          member_cap_override?: number | null
          name: string
          primary_color?: string | null
          status?: Database["public"]["Enums"]["gym_status"]
          tier_id: string
          timezone?: string
        }
        Update: {
          alert_auto_dismiss_minutes?: number
          capacity?: number | null
          created_at?: string
          default_language?: string
          grace_period_days?: number
          gym_token?: string
          id?: string
          logo_url?: string | null
          member_cap_override?: number | null
          name?: string
          primary_color?: string | null
          status?: Database["public"]["Enums"]["gym_status"]
          tier_id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "gyms_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          job_name: string
          started_at: string
          status: Database["public"]["Enums"]["job_status"] | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"] | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"] | null
        }
        Relationships: []
      }
      members: {
        Row: {
          created_at: string
          deactivated_at: string | null
          dob: string | null
          email: string | null
          emergency_contact: string | null
          gym_id: string
          id: string
          join_date: string
          name: string
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          dob?: string | null
          email?: string | null
          emergency_contact?: string | null
          gym_id: string
          id?: string
          join_date?: string
          name: string
          phone?: string | null
          photo_url?: string | null
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          dob?: string | null
          email?: string | null
          emergency_contact?: string | null
          gym_id?: string
          id?: string
          join_date?: string
          name?: string
          phone?: string | null
          photo_url?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          actor_id: string | null
          amount: number
          created_at: string
          currency: string
          gym_id: string
          id: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          provider_transaction_ref: string | null
          reason: string | null
          status: Database["public"]["Enums"]["payment_status"]
          subscription_id: string | null
        }
        Insert: {
          actor_id?: string | null
          amount: number
          created_at?: string
          currency?: string
          gym_id: string
          id?: string
          member_id: string
          method: Database["public"]["Enums"]["payment_method"]
          provider_transaction_ref?: string | null
          reason?: string | null
          status: Database["public"]["Enums"]["payment_status"]
          subscription_id?: string | null
        }
        Update: {
          actor_id?: string | null
          amount?: number
          created_at?: string
          currency?: string
          gym_id?: string
          id?: string
          member_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          provider_transaction_ref?: string | null
          reason?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          annual_discount_percent: number | null
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          created_at: string
          currency: string
          duration_days: number | null
          gym_id: string
          id: string
          name: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          price: number
        }
        Insert: {
          annual_discount_percent?: number | null
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          created_at?: string
          currency?: string
          duration_days?: number | null
          gym_id: string
          id?: string
          name: string
          plan_type: Database["public"]["Enums"]["plan_type"]
          price: number
        }
        Update: {
          annual_discount_percent?: number | null
          billing_interval?: Database["public"]["Enums"]["billing_interval"]
          created_at?: string
          currency?: string
          duration_days?: number | null
          gym_id?: string
          id?: string
          name?: string
          plan_type?: Database["public"]["Enums"]["plan_type"]
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "plans_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          expiry_date: string
          gym_id: string
          id: string
          member_id: string
          plan_id: string
          start_date: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Insert: {
          created_at?: string
          expiry_date: string
          gym_id: string
          id?: string
          member_id: string
          plan_id: string
          start_date: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Update: {
          created_at?: string
          expiry_date?: string
          gym_id?: string
          id?: string
          member_id?: string
          plan_id?: string
          start_date?: string
          status?: Database["public"]["Enums"]["subscription_status"]
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      tiers: {
        Row: {
          annual_price: number
          created_at: string
          id: string
          member_cap: number | null
          monthly_price: number
          name: string
        }
        Insert: {
          annual_price: number
          created_at?: string
          id?: string
          member_cap?: number | null
          monthly_price: number
          name: string
        }
        Update: {
          annual_price?: number
          created_at?: string
          id?: string
          member_cap?: number | null
          monthly_price?: number
          name?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_super_admin: boolean
          must_change_password: boolean
          phone: string | null
          preferred_language: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          is_super_admin?: boolean
          must_change_password?: boolean
          phone?: string | null
          preferred_language?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_super_admin?: boolean
          must_change_password?: boolean
          phone?: string | null
          preferred_language?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      gym_member_count: { Args: { p_gym_id: string }; Returns: number }
      log_audit_event: {
        Args: {
          p_action_type: string
          p_gym_id?: string
          p_metadata?: Json
          p_system_actor_label?: string
          p_target_entity_id?: string
          p_target_entity_type?: string
        }
        Returns: string
      }
      platform_metrics: {
        Args: never
        Returns: {
          active_gyms: number
          deactivated_gyms: number
          suspended_gyms: number
          total_gyms: number
          total_members: number
          total_payments_processed: number
        }[]
      }
    }
    Enums: {
      billing_interval: "monthly" | "annual"
      gym_status: "active" | "suspended" | "deactivated"
      job_status: "success" | "failure"
      member_role: "member" | "coach" | "receptionist" | "manager" | "owner"
      payment_method:
        | "mtn_momo"
        | "orange_money"
        | "cash"
        | "bank_transfer"
        | "manual_momo"
      payment_status: "pending" | "processing" | "verified" | "flagged"
      plan_type:
        | "pay_per_session"
        | "monthly"
        | "coach_inclusive"
        | "class_only"
      subscription_status:
        | "active"
        | "expiring_soon"
        | "grace_period"
        | "expired"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      billing_interval: ["monthly", "annual"],
      gym_status: ["active", "suspended", "deactivated"],
      job_status: ["success", "failure"],
      member_role: ["member", "coach", "receptionist", "manager", "owner"],
      payment_method: [
        "mtn_momo",
        "orange_money",
        "cash",
        "bank_transfer",
        "manual_momo",
      ],
      payment_status: ["pending", "processing", "verified", "flagged"],
      plan_type: [
        "pay_per_session",
        "monthly",
        "coach_inclusive",
        "class_only",
      ],
      subscription_status: [
        "active",
        "expiring_soon",
        "grace_period",
        "expired",
      ],
    },
  },
} as const

