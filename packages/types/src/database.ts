export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      attendance_events: {
        Row: {
          checked_in_at: string
          checked_out_at: string | null
          checkout_type: string | null
          client_scan_id: string | null
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        Insert: {
          checked_in_at?: string
          checked_out_at?: string | null
          checkout_type?: string | null
          client_scan_id?: string | null
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
        }
        Update: {
          checked_in_at?: string
          checked_out_at?: string | null
          checkout_type?: string | null
          client_scan_id?: string | null
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_events_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_events_member_id_fkey"
            columns: ["member_id"]
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
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      class_bookings: {
        Row: {
          attended_at: string | null
          class_session_id: string
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        Insert: {
          attended_at?: string | null
          class_session_id: string
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
        }
        Update: {
          attended_at?: string | null
          class_session_id?: string
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_bookings_class_session_id_fkey"
            columns: ["class_session_id"]
            referencedRelation: "class_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_bookings_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_bookings_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      class_sessions: {
        Row: {
          class_id: string
          created_at: string
          gym_id: string
          id: string
          scheduled_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          gym_id: string
          id?: string
          scheduled_at: string
        }
        Update: {
          class_id?: string
          created_at?: string
          gym_id?: string
          id?: string
          scheduled_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_sessions_class_id_fkey"
            columns: ["class_id"]
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_sessions_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          capacity: number
          coach_id: string
          created_at: string
          description: string | null
          gym_id: string
          id: string
          name: string
          one_off_session_at: string | null
          recurrence_days: number[] | null
          recurrence_start_date: string | null
          recurrence_time: string | null
          schedule_type: string
        }
        Insert: {
          capacity: number
          coach_id: string
          created_at?: string
          description?: string | null
          gym_id: string
          id?: string
          name: string
          one_off_session_at?: string | null
          recurrence_days?: number[] | null
          recurrence_start_date?: string | null
          recurrence_time?: string | null
          schedule_type: string
        }
        Update: {
          capacity?: number
          coach_id?: string
          created_at?: string
          description?: string | null
          gym_id?: string
          id?: string
          name?: string
          one_off_session_at?: string | null
          recurrence_days?: number[] | null
          recurrence_start_date?: string | null
          recurrence_time?: string | null
          schedule_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_coach_id_fkey"
            columns: ["coach_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_assignments: {
        Row: {
          coach_id: string
          created_at: string
          ended_at: string | null
          gym_id: string
          id: string
          member_id: string
          started_at: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          ended_at?: string | null
          gym_id: string
          id?: string
          member_id: string
          started_at?: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          ended_at?: string | null
          gym_id?: string
          id?: string
          member_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_assignments_coach_id_fkey"
            columns: ["coach_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assignments_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assignments_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          created_at: string
          expo_push_token: string
          id: string
          platform: Database["public"]["Enums"]["device_platform"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expo_push_token: string
          id?: string
          platform: Database["public"]["Enums"]["device_platform"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expo_push_token?: string
          id?: string
          platform?: Database["public"]["Enums"]["device_platform"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_library: {
        Row: {
          created_at: string
          gym_id: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          gym_id?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          gym_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_library_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      front_desk_alerts: {
        Row: {
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          expiry_date: string | null
          gym_id: string
          id: string
          member_id: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          expiry_date?: string | null
          gym_id: string
          id?: string
          member_id: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          expiry_date?: string | null
          gym_id?: string
          id?: string
          member_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
        }
        Relationships: [
          {
            foreignKeyName: "front_desk_alerts_dismissed_by_fkey"
            columns: ["dismissed_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "front_desk_alerts_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "front_desk_alerts_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_payment_credentials: {
        Row: {
          business_id_masked: string
          business_id_plain: string | null
          connected_at: string
          connected_by: string | null
          credentials_secret_id: string
          gym_id: string
          id: string
          needs_attention: boolean
          provider_key: string
          updated_at: string
        }
        Insert: {
          business_id_masked: string
          business_id_plain?: string | null
          connected_at?: string
          connected_by?: string | null
          credentials_secret_id: string
          gym_id: string
          id?: string
          needs_attention?: boolean
          provider_key: string
          updated_at?: string
        }
        Update: {
          business_id_masked?: string
          business_id_plain?: string | null
          connected_at?: string
          connected_by?: string | null
          credentials_secret_id?: string
          gym_id?: string
          id?: string
          needs_attention?: boolean
          provider_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gym_payment_credentials_connected_by_fkey"
            columns: ["connected_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_payment_credentials_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_payment_credentials_provider_key_fkey"
            columns: ["provider_key"]
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_key"]
          },
        ]
      }
      gyms: {
        Row: {
          alert_auto_dismiss_minutes: number
          capacity: number | null
          checkin_timeout_hours: number
          class_booking_cancellation_cutoff_minutes: number
          closing_time: string | null
          created_at: string
          default_language: string
          grace_period_days: number
          gym_token: string
          id: string
          logo_url: string | null
          member_cap_override: number | null
          name: string
          opening_time: string | null
          primary_color: string | null
          saas_billing_anchor_date: string
          saas_billing_interval: Database["public"]["Enums"]["billing_interval"]
          saas_billing_status: Database["public"]["Enums"]["saas_billing_status"]
          saas_grace_period_days: number
          status: Database["public"]["Enums"]["gym_status"]
          tier_id: string
          timezone: string
        }
        Insert: {
          alert_auto_dismiss_minutes?: number
          capacity?: number | null
          checkin_timeout_hours?: number
          class_booking_cancellation_cutoff_minutes?: number
          closing_time?: string | null
          created_at?: string
          default_language?: string
          grace_period_days?: number
          gym_token?: string
          id?: string
          logo_url?: string | null
          member_cap_override?: number | null
          name: string
          opening_time?: string | null
          primary_color?: string | null
          saas_billing_anchor_date?: string
          saas_billing_interval?: Database["public"]["Enums"]["billing_interval"]
          saas_billing_status?: Database["public"]["Enums"]["saas_billing_status"]
          saas_grace_period_days?: number
          status?: Database["public"]["Enums"]["gym_status"]
          tier_id: string
          timezone?: string
        }
        Update: {
          alert_auto_dismiss_minutes?: number
          capacity?: number | null
          checkin_timeout_hours?: number
          class_booking_cancellation_cutoff_minutes?: number
          closing_time?: string | null
          created_at?: string
          default_language?: string
          grace_period_days?: number
          gym_token?: string
          id?: string
          logo_url?: string | null
          member_cap_override?: number | null
          name?: string
          opening_time?: string | null
          primary_color?: string | null
          saas_billing_anchor_date?: string
          saas_billing_interval?: Database["public"]["Enums"]["billing_interval"]
          saas_billing_status?: Database["public"]["Enums"]["saas_billing_status"]
          saas_grace_period_days?: number
          status?: Database["public"]["Enums"]["gym_status"]
          tier_id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "gyms_tier_id_fkey"
            columns: ["tier_id"]
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
      member_preferences: {
        Row: {
          class_reminder_opted_out: boolean
          created_at: string
          gym_id: string
          id: string
          member_id: string
          quiet_gym_alerts_opted_out: boolean
          updated_at: string
        }
        Insert: {
          class_reminder_opted_out?: boolean
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
          quiet_gym_alerts_opted_out?: boolean
          updated_at?: string
        }
        Update: {
          class_reminder_opted_out?: boolean
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
          quiet_gym_alerts_opted_out?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_preferences_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_preferences_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          deactivated_at: string | null
          dob: string | null
          email: string | null
          emergency_contact: string | null
          experience_level: string | null
          goal: string | null
          gym_id: string
          height_cm: number | null
          id: string
          join_date: string
          name: string
          onboarding_completed_at: string | null
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["member_role"]
          starting_weight_kg: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          dob?: string | null
          email?: string | null
          emergency_contact?: string | null
          experience_level?: string | null
          goal?: string | null
          gym_id: string
          height_cm?: number | null
          id?: string
          join_date?: string
          name: string
          onboarding_completed_at?: string | null
          phone?: string | null
          photo_url?: string | null
          role: Database["public"]["Enums"]["member_role"]
          starting_weight_kg?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          dob?: string | null
          email?: string | null
          emergency_contact?: string | null
          experience_level?: string | null
          goal?: string | null
          gym_id?: string
          height_cm?: number | null
          id?: string
          join_date?: string
          name?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          photo_url?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          starting_weight_kg?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_provider_config: {
        Row: {
          id: string
          instance_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          instance_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          instance_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messaging_provider_config_updated_by_fkey"
            columns: ["updated_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_resend_attempts: {
        Row: {
          locked_until: string | null
          phone: string
          resend_count: number
          updated_at: string
        }
        Insert: {
          locked_until?: string | null
          phone: string
          resend_count?: number
          updated_at?: string
        }
        Update: {
          locked_until?: string | null
          phone?: string
          resend_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_discrepancies: {
        Row: {
          details: Json
          detected_at: string
          discrepancy_type: Database["public"]["Enums"]["payment_discrepancy_type"]
          gym_id: string | null
          id: string
          payment_id: string | null
          webhook_event_id: string | null
        }
        Insert: {
          details?: Json
          detected_at?: string
          discrepancy_type: Database["public"]["Enums"]["payment_discrepancy_type"]
          gym_id?: string | null
          id?: string
          payment_id?: string | null
          webhook_event_id?: string | null
        }
        Update: {
          details?: Json
          detected_at?: string
          discrepancy_type?: Database["public"]["Enums"]["payment_discrepancy_type"]
          gym_id?: string | null
          id?: string
          payment_id?: string | null
          webhook_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_discrepancies_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_discrepancies_payment_id_fkey"
            columns: ["payment_id"]
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_discrepancies_webhook_event_id_fkey"
            columns: ["webhook_event_id"]
            referencedRelation: "payment_webhook_events"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          provider_key: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          provider_key: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          provider_key?: string
        }
        Relationships: []
      }
      payment_webhook_events: {
        Row: {
          amount: number
          currency: string
          id: string
          matched_payment_id: string | null
          matched_saas_billing_payment_id: string | null
          provider_key: string
          provider_transaction_ref: string
          raw_payload: Json
          received_at: string
          reference: string | null
          status: string
        }
        Insert: {
          amount: number
          currency: string
          id?: string
          matched_payment_id?: string | null
          matched_saas_billing_payment_id?: string | null
          provider_key: string
          provider_transaction_ref: string
          raw_payload: Json
          received_at?: string
          reference?: string | null
          status: string
        }
        Update: {
          amount?: number
          currency?: string
          id?: string
          matched_payment_id?: string | null
          matched_saas_billing_payment_id?: string | null
          provider_key?: string
          provider_transaction_ref?: string
          raw_payload?: Json
          received_at?: string
          reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_webhook_events_matched_payment_id_fkey"
            columns: ["matched_payment_id"]
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_webhook_events_matched_saas_billing_payment_id_fkey"
            columns: ["matched_saas_billing_payment_id"]
            referencedRelation: "saas_billing_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_webhook_events_provider_key_fkey"
            columns: ["provider_key"]
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_key"]
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
          method: string
          provider: string | null
          provider_fee_amount: number | null
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
          method: string
          provider?: string | null
          provider_fee_amount?: number | null
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
          method?: string
          provider?: string | null
          provider_fee_amount?: number | null
          provider_transaction_ref?: string | null
          reason?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_actor_id_fkey"
            columns: ["actor_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_provider_fkey"
            columns: ["provider"]
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_key"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            referencedRelation: "subscriptions_current"
            referencedColumns: ["subscription_id"]
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
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_entries: {
        Row: {
          arms_cm: number | null
          chest_cm: number | null
          client_entry_id: string | null
          deactivated_at: string | null
          gym_id: string
          hips_cm: number | null
          id: string
          logged_at: string
          member_id: string
          note: string | null
          thighs_cm: number | null
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          arms_cm?: number | null
          chest_cm?: number | null
          client_entry_id?: string | null
          deactivated_at?: string | null
          gym_id: string
          hips_cm?: number | null
          id?: string
          logged_at?: string
          member_id: string
          note?: string | null
          thighs_cm?: number | null
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          arms_cm?: number | null
          chest_cm?: number | null
          client_entry_id?: string | null
          deactivated_at?: string | null
          gym_id?: string
          hips_cm?: number | null
          id?: string
          logged_at?: string
          member_id?: string
          note?: string | null
          thighs_cm?: number | null
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "progress_entries_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_entries_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_photos: {
        Row: {
          created_at: string
          gym_id: string
          id: string
          member_id: string
          photo_path: string
          progress_entry_id: string
          shared_with_coach: boolean
        }
        Insert: {
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
          photo_path: string
          progress_entry_id: string
          shared_with_coach?: boolean
        }
        Update: {
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
          photo_path?: string
          progress_entry_id?: string
          shared_with_coach?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "progress_photos_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_photos_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_photos_progress_entry_id_fkey"
            columns: ["progress_entry_id"]
            referencedRelation: "progress_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          actor_id: string
          amount: number
          created_at: string
          currency: string
          gym_id: string
          id: string
          payment_id: string
          reason: string
        }
        Insert: {
          actor_id: string
          amount: number
          created_at?: string
          currency?: string
          gym_id: string
          id?: string
          payment_id: string
          reason: string
        }
        Update: {
          actor_id?: string
          amount?: number
          created_at?: string
          currency?: string
          gym_id?: string
          id?: string
          payment_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_actor_id_fkey"
            columns: ["actor_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_billing_notices: {
        Row: {
          billing_anchor_date_at_notice: string
          created_at: string
          email_error: string | null
          email_status: string
          gym_id: string
          id: string
          notice_day_offset: number
          sms_error: string | null
          sms_status: string
          whatsapp_error: string | null
          whatsapp_status: string
        }
        Insert: {
          billing_anchor_date_at_notice: string
          created_at?: string
          email_error?: string | null
          email_status: string
          gym_id: string
          id?: string
          notice_day_offset: number
          sms_error?: string | null
          sms_status: string
          whatsapp_error?: string | null
          whatsapp_status: string
        }
        Update: {
          billing_anchor_date_at_notice?: string
          created_at?: string
          email_error?: string | null
          email_status?: string
          gym_id?: string
          id?: string
          notice_day_offset?: number
          sms_error?: string | null
          sms_status?: string
          whatsapp_error?: string | null
          whatsapp_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_billing_notices_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_billing_payments: {
        Row: {
          amount: number
          billing_interval: Database["public"]["Enums"]["billing_interval"] | null
          created_at: string
          currency: string
          gym_id: string
          id: string
          provider: string | null
          provider_fee_amount: number | null
          provider_transaction_ref: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tier_id: string | null
        }
        Insert: {
          amount: number
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null
          created_at?: string
          currency?: string
          gym_id: string
          id?: string
          provider?: string | null
          provider_fee_amount?: number | null
          provider_transaction_ref?: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tier_id?: string | null
        }
        Update: {
          amount?: number
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null
          created_at?: string
          currency?: string
          gym_id?: string
          id?: string
          provider?: string | null
          provider_fee_amount?: number | null
          provider_transaction_ref?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_billing_payments_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_billing_payments_provider_fkey"
            columns: ["provider"]
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_key"]
          },
          {
            foreignKeyName: "saas_billing_payments_tier_id_fkey"
            columns: ["tier_id"]
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      session_notes: {
        Row: {
          coach_assignment_id: string
          coach_id: string
          created_at: string
          edited_at: string | null
          gym_id: string
          id: string
          member_id: string
          note_text: string
        }
        Insert: {
          coach_assignment_id: string
          coach_id: string
          created_at?: string
          edited_at?: string | null
          gym_id: string
          id?: string
          member_id: string
          note_text: string
        }
        Update: {
          coach_assignment_id?: string
          coach_id?: string
          created_at?: string
          edited_at?: string | null
          gym_id?: string
          id?: string
          member_id?: string
          note_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_notes_coach_assignment_id_fkey"
            columns: ["coach_assignment_id"]
            referencedRelation: "coach_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_coach_id_fkey"
            columns: ["coach_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          expiry_date: string | null
          gym_id: string
          id: string
          member_id: string
          plan_id: string
          start_date: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          gym_id: string
          id?: string
          member_id: string
          plan_id: string
          start_date: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
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
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
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
          price_locked: boolean
        }
        Insert: {
          annual_price: number
          created_at?: string
          id?: string
          member_cap?: number | null
          monthly_price: number
          name: string
          price_locked?: boolean
        }
        Update: {
          annual_price?: number
          created_at?: string
          id?: string
          member_cap?: number | null
          monthly_price?: number
          name?: string
          price_locked?: boolean
        }
        Relationships: []
      }
      users: {
        Row: {
          active_gym_id: string | null
          created_at: string
          display_name: string | null
          id: string
          is_super_admin: boolean
          must_change_password: boolean
          phone: string | null
          photo_url: string | null
          preferred_language: string
        }
        Insert: {
          active_gym_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_super_admin?: boolean
          must_change_password?: boolean
          phone?: string | null
          photo_url?: string | null
          preferred_language?: string
        }
        Update: {
          active_gym_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_super_admin?: boolean
          must_change_password?: boolean
          phone?: string | null
          photo_url?: string | null
          preferred_language?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_active_gym_id_fkey"
            columns: ["active_gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_plan_completions: {
        Row: {
          client_completion_id: string | null
          completed_at: string
          exercise_id: string
          gym_id: string
          id: string
          member_id: string
          plan_id: string
        }
        Insert: {
          client_completion_id?: string | null
          completed_at?: string
          exercise_id: string
          gym_id: string
          id?: string
          member_id: string
          plan_id: string
        }
        Update: {
          client_completion_id?: string | null
          completed_at?: string
          exercise_id?: string
          gym_id?: string
          id?: string
          member_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_plan_completions_exercise_id_fkey"
            columns: ["exercise_id"]
            referencedRelation: "exercise_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plan_completions_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plan_completions_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plan_completions_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "workout_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_plan_exercises: {
        Row: {
          exercise_id: string
          gym_id: string
          id: string
          member_id: string
          note: string | null
          order_index: number
          plan_id: string
          reps: number
          sets: number
        }
        Insert: {
          exercise_id: string
          gym_id: string
          id?: string
          member_id: string
          note?: string | null
          order_index: number
          plan_id: string
          reps: number
          sets: number
        }
        Update: {
          exercise_id?: string
          gym_id?: string
          id?: string
          member_id?: string
          note?: string | null
          order_index?: number
          plan_id?: string
          reps?: number
          sets?: number
        }
        Relationships: [
          {
            foreignKeyName: "workout_plan_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            referencedRelation: "exercise_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plan_exercises_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plan_exercises_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plan_exercises_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "workout_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_plans: {
        Row: {
          coach_id: string
          created_at: string
          gym_id: string
          id: string
          member_id: string
          name: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          gym_id: string
          id?: string
          member_id: string
          name: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          gym_id?: string
          id?: string
          member_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_plans_coach_id_fkey"
            columns: ["coach_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plans_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plans_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      subscriptions_current: {
        Row: {
          deactivated_at: string | null
          expiry_date: string | null
          gym_id: string | null
          join_date: string | null
          member_id: string | null
          member_name: string | null
          member_phone: string | null
          plan_id: string | null
          plan_name: string | null
          plan_type: Database["public"]["Enums"]["plan_type"] | null
          start_date: string | null
          status: Database["public"]["Enums"]["subscription_status"] | null
          subscription_created_at: string | null
          subscription_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_gym_id_fkey"
            columns: ["gym_id"]
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_member_id_fkey"
            columns: ["member_id"]
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_payment_provider: {
        Args: { p_provider_key: string }
        Returns: undefined
      }
      active_payment_provider: { Args: never; Returns: string }
      add_session_note: {
        Args: { p_member_id: string; p_note_text: string }
        Returns: string
      }
      apply_saas_billing_credit: {
        Args: { p_days: number; p_gym_id: string }
        Returns: {
          new_anchor_date: string
          previous_anchor_date: string
        }[]
      }
      assign_coach: {
        Args: { p_coach_id: string; p_member_id: string }
        Returns: string
      }
      book_class_session: {
        Args: { p_class_session_id: string }
        Returns: {
          attended_at: string | null
          class_session_id: string
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        SetofOptions: {
          from: "*"
          to: "class_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      caller_has_membership: { Args: never; Returns: boolean }
      cancel_class_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      check_in: {
        Args: { p_client_scan_id?: string; p_scanned_at?: string }
        Returns: {
          checked_in_at: string
          checked_out_at: string | null
          checkout_type: string | null
          client_scan_id: string | null
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_otp_resend_allowed: {
        Args: { p_phone: string }
        Returns: {
          allowed: boolean
          locked_until: string
        }[]
      }
      check_out: {
        Args: never
        Returns: {
          checked_in_at: string
          checked_out_at: string | null
          checkout_type: string | null
          client_scan_id: string | null
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_out_member: {
        Args: { p_member_id: string }
        Returns: {
          checked_in_at: string
          checked_out_at: string | null
          checkout_type: string | null
          client_scan_id: string | null
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_flagged_payment: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      complete_flagged_saas_billing_payment: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      complete_verified_payment: {
        Args: { p_fee_amount: number; p_payment_id: string }
        Returns: string
      }
      complete_verified_saas_billing_payment: {
        Args: { p_fee_amount: number; p_payment_id: string }
        Returns: undefined
      }
      confirm_renewal: {
        Args: {
          p_backdate?: boolean
          p_member_id: string
          p_method: string
          p_reason: string
        }
        Returns: Record<string, unknown>
      }
      connect_gym_payment_credentials: {
        Args: {
          p_api_key: string
          p_business_id: string
          p_provider_key: string
          p_webhook_secret: string
        }
        Returns: undefined
      }
      create_class: {
        Args: {
          p_capacity: number
          p_coach_id: string
          p_description: string
          p_name: string
          p_one_off_session_at: string
          p_recurrence_days: number[]
          p_recurrence_start_date: string
          p_recurrence_time: string
          p_schedule_type: string
        }
        Returns: string
      }
      create_staff_member: {
        Args: {
          p_name: string
          p_phone: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_user_id: string
        }
        Returns: {
          created_at: string
          deactivated_at: string | null
          dob: string | null
          email: string | null
          emergency_contact: string | null
          experience_level: string | null
          goal: string | null
          gym_id: string
          height_cm: number | null
          id: string
          join_date: string
          name: string
          onboarding_completed_at: string | null
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["member_role"]
          starting_weight_kg: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_workout_plan: {
        Args: { p_exercises: Json; p_member_id: string; p_name: string }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      deactivate_staff_member: {
        Args: { p_member_id: string; p_reason: string }
        Returns: {
          created_at: string
          deactivated_at: string | null
          dob: string | null
          email: string | null
          emergency_contact: string | null
          experience_level: string | null
          goal: string | null
          gym_id: string
          height_cm: number | null
          id: string
          join_date: string
          name: string
          onboarding_completed_at: string | null
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["member_role"]
          starting_weight_kg: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      disconnect_gym_payment_credentials: {
        Args: { p_provider_key: string }
        Returns: undefined
      }
      edit_session_note: {
        Args: { p_note_id: string; p_note_text: string }
        Returns: undefined
      }
      get_gym_payment_connection_status: {
        Args: { p_provider_key: string }
        Returns: {
          business_id_masked: string
          connected_at: string
          needs_attention: boolean
        }[]
      }
      get_gym_payment_credentials_by_business_id: {
        Args: { p_business_id: string; p_provider_key: string }
        Returns: {
          api_key: string
          business_id: string
          gym_id: string
          webhook_secret: string
        }[]
      }
      get_gym_payment_credentials_for_service: {
        Args: { p_gym_id: string; p_provider_key: string }
        Returns: {
          api_key: string
          business_id: string
          webhook_secret: string
        }[]
      }
      get_workout_plan_viewer_context: {
        Args: { p_plan_id: string }
        Returns: {
          author_name: string
          is_authoring_coach: boolean
        }[]
      }
      gym_effective_member_cap: { Args: never; Returns: number }
      gym_member_count: { Args: { p_gym_id: string }; Returns: number }
      initiate_member_payment: { Args: never; Returns: string }
      initiate_saas_billing_payment: {
        Args: {
          p_interval?: Database["public"]["Enums"]["billing_interval"]
          p_tier_id?: string
        }
        Returns: string
      }
      list_bookable_class_sessions: {
        Args: never
        Returns: {
          booked_count: number
          capacity: number
          class_name: string
          class_session_id: string
          coach_name: string
          description: string
          my_booking_id: string
          scheduled_at: string
        }[]
      }
      list_my_class_bookings: {
        Args: never
        Returns: {
          booking_id: string
          can_cancel: boolean
          class_name: string
          scheduled_at: string
        }[]
      }
      list_own_active_gym_memberships: {
        Args: never
        Returns: {
          gym_id: string
          gym_name: string
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      list_selectable_saas_billing_tiers: {
        Args: never
        Returns: {
          annual_price: number
          id: string
          monthly_price: number
          name: string
        }[]
      }
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
      mark_class_attendance: {
        Args: { p_booking_id: string }
        Returns: {
          attended_at: string | null
          class_session_id: string
          created_at: string
          gym_id: string
          id: string
          member_id: string
        }
        SetofOptions: {
          from: "*"
          to: "class_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_gym_payment_credentials_needs_attention: {
        Args: { p_gym_id: string; p_provider_key: string }
        Returns: undefined
      }
      materialize_class_sessions: {
        Args: { p_class_id: string; p_reschedule?: boolean }
        Returns: undefined
      }
      member_occupancy_band: { Args: never; Returns: string }
      phone_has_membership: { Args: { p_phone: string }; Returns: boolean }
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
      record_otp_resend: {
        Args: { p_phone: string }
        Returns: {
          allowed: boolean
          attempts_remaining: number
          locked_until: string
        }[]
      }
      record_out_of_band_saas_billing_payment: {
        Args: { p_gym_id: string }
        Returns: {
          amount: number
          id: string
          new_anchor_date: string
          previous_anchor_date: string
        }[]
      }
      renew_subscription: {
        Args: { p_member_id: string; p_reason: string }
        Returns: string
      }
      run_check_in_auto_timeout_job: { Args: never; Returns: undefined }
      run_class_reminder_job: { Args: never; Returns: undefined }
      run_class_session_materializer_job: { Args: never; Returns: undefined }
      run_payment_reconciliation_job: { Args: never; Returns: undefined }
      run_quiet_gym_alert_job: { Args: never; Returns: undefined }
      run_saas_billing_lifecycle_job: { Args: never; Returns: undefined }
      run_subscription_lifecycle_job: { Args: never; Returns: undefined }
      staff_account_for_reset: {
        Args: { p_member_id: string }
        Returns: {
          name: string
          phone: string
          user_id: string
        }[]
      }
      super_admin_job_failures: {
        Args: never
        Returns: {
          error: string
          finished_at: string
          id: string
          job_name: string
          started_at: string
        }[]
      }
      switch_active_gym: { Args: { p_gym_id: string }; Returns: undefined }
      take_ownership_of_workout_plan: {
        Args: { p_plan_id: string }
        Returns: undefined
      }
      update_class: {
        Args: {
          p_capacity: number
          p_class_id: string
          p_coach_id: string
          p_description: string
          p_name: string
          p_one_off_session_at: string
          p_recurrence_days: number[]
          p_recurrence_start_date: string
          p_recurrence_time: string
          p_schedule_type: string
        }
        Returns: undefined
      }
      update_messaging_instance: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      update_own_owner_notification_email: {
        Args: { p_email: string }
        Returns: undefined
      }
      update_staff_role: {
        Args: {
          p_member_id: string
          p_name: string
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: {
          created_at: string
          deactivated_at: string | null
          dob: string | null
          email: string | null
          emergency_contact: string | null
          experience_level: string | null
          goal: string | null
          gym_id: string
          height_cm: number | null
          id: string
          join_date: string
          name: string
          onboarding_completed_at: string | null
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["member_role"]
          starting_weight_kg: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_workout_plan: {
        Args: { p_exercises: Json; p_name: string; p_plan_id: string }
        Returns: undefined
      }
    }
    Enums: {
      billing_interval: "monthly" | "annual"
      device_platform: "ios" | "android"
      gym_status: "active" | "suspended" | "deactivated"
      job_status: "success" | "failure"
      member_role:
        | "member"
        | "coach"
        | "receptionist"
        | "manager"
        | "owner"
        | "supervisor"
      payment_discrepancy_type:
        | "missing_internal_record"
        | "stale_processing"
        | "amount_mismatch"
        | "wrong_account_settlement"
      payment_status: "pending" | "processing" | "verified" | "flagged"
      plan_type:
        | "pay_per_session"
        | "monthly"
        | "coach_inclusive"
        | "class_only"
      saas_billing_status: "active" | "past_due" | "grace_period" | "suspended"
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
  public: {
    Enums: {
      billing_interval: ["monthly", "annual"],
      device_platform: ["ios", "android"],
      gym_status: ["active", "suspended", "deactivated"],
      job_status: ["success", "failure"],
      member_role: [
        "member",
        "coach",
        "receptionist",
        "manager",
        "owner",
        "supervisor",
      ],
      payment_discrepancy_type: [
        "missing_internal_record",
        "stale_processing",
        "amount_mismatch",
        "wrong_account_settlement",
      ],
      payment_status: ["pending", "processing", "verified", "flagged"],
      plan_type: [
        "pay_per_session",
        "monthly",
        "coach_inclusive",
        "class_only",
      ],
      saas_billing_status: ["active", "past_due", "grace_period", "suspended"],
      subscription_status: [
        "active",
        "expiring_soon",
        "grace_period",
        "expired",
      ],
    },
  },
} as const
