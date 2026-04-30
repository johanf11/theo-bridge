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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      customers: {
        Row: {
          business_type: string | null
          company_name: string
          contact_name: string | null
          country: string | null
          created_at: string
          email: string
          id: string
          kyb_rejection_reason: string | null
          kyb_status: Database["public"]["Enums"]["kyb_status"]
          kyb_submitted_at: string | null
          legal_name: string | null
          phone: string | null
          registration_number: string | null
          stellar_wallet_address: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_type?: string | null
          company_name: string
          contact_name?: string | null
          country?: string | null
          created_at?: string
          email: string
          id?: string
          kyb_rejection_reason?: string | null
          kyb_status?: Database["public"]["Enums"]["kyb_status"]
          kyb_submitted_at?: string | null
          legal_name?: string | null
          phone?: string | null
          registration_number?: string | null
          stellar_wallet_address?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_type?: string | null
          company_name?: string
          contact_name?: string | null
          country?: string | null
          created_at?: string
          email?: string
          id?: string
          kyb_rejection_reason?: string | null
          kyb_status?: Database["public"]["Enums"]["kyb_status"]
          kyb_submitted_at?: string | null
          legal_name?: string | null
          phone?: string | null
          registration_number?: string | null
          stellar_wallet_address?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      job_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          last_error: string | null
          max_attempts: number
          payload: Json
          result: Json | null
          scheduled_for: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          completed_at: string | null
          created_at: string
          customer_id: string
          failure_reason: string | null
          forward_premium: number
          funded_at: string | null
          htg_amount: number
          id: string
          margin: number
          quote_expires_at: string
          rate: number
          reference_number: string
          released_at: string | null
          spot_rate: number
          status: Database["public"]["Enums"]["order_status"]
          stellar_tx_hash: string | null
          updated_at: string
          usdc_amount: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          customer_id: string
          failure_reason?: string | null
          forward_premium?: number
          funded_at?: string | null
          htg_amount: number
          id?: string
          margin?: number
          quote_expires_at: string
          rate: number
          reference_number: string
          released_at?: string | null
          spot_rate: number
          status?: Database["public"]["Enums"]["order_status"]
          stellar_tx_hash?: string | null
          updated_at?: string
          usdc_amount: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          failure_reason?: string | null
          forward_premium?: number
          funded_at?: string | null
          htg_amount?: number
          id?: string
          margin?: number
          quote_expires_at?: string
          rate?: number
          reference_number?: string
          released_at?: string | null
          spot_rate?: number
          status?: Database["public"]["Enums"]["order_status"]
          stellar_tx_hash?: string | null
          updated_at?: string
          usdc_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_snapshots: {
        Row: {
          captured_at: string
          id: string
          source: string
          spot_rate: number
        }
        Insert: {
          captured_at?: string
          id?: string
          source?: string
          spot_rate: number
        }
        Update: {
          captured_at?: string
          id?: string
          source?: string
          spot_rate?: number
        }
        Relationships: []
      }
      spih_imports: {
        Row: {
          created_at: string
          id: string
          matched_rows: number
          raw_data: Json | null
          source: string
          total_rows: number
          unmatched_rows: number
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          matched_rows?: number
          raw_data?: Json | null
          source: string
          total_rows?: number
          unmatched_rows?: number
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          matched_rows?: number
          raw_data?: Json | null
          source?: string
          total_rows?: number
          unmatched_rows?: number
          uploaded_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          label: string | null
          stellar_address: string
          updated_at: string
          usdc_balance: number
          wallet_type: Database["public"]["Enums"]["wallet_type"]
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          label?: string | null
          stellar_address: string
          updated_at?: string
          usdc_balance?: number
          wallet_type: Database["public"]["Enums"]["wallet_type"]
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          label?: string | null
          stellar_address?: string
          updated_at?: string
          usdc_balance?: number
          wallet_type?: Database["public"]["Enums"]["wallet_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wallets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "customer"
      job_status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
      job_type: "SPIH_RECONCILE" | "USDC_RELEASE" | "STELLAR_CONFIRM"
      kyb_status: "PENDING" | "APPROVED" | "REJECTED" | "UNDER_REVIEW"
      order_status:
        | "CREATED"
        | "QUOTED"
        | "FUNDED"
        | "RELEASING"
        | "COMPLETED"
        | "FAILED"
        | "EXPIRED"
        | "REFUNDED"
      wallet_type: "TREASURY" | "CUSTOMER"
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
      app_role: ["admin", "customer"],
      job_status: ["PENDING", "RUNNING", "COMPLETED", "FAILED"],
      job_type: ["SPIH_RECONCILE", "USDC_RELEASE", "STELLAR_CONFIRM"],
      kyb_status: ["PENDING", "APPROVED", "REJECTED", "UNDER_REVIEW"],
      order_status: [
        "CREATED",
        "QUOTED",
        "FUNDED",
        "RELEASING",
        "COMPLETED",
        "FAILED",
        "EXPIRED",
        "REFUNDED",
      ],
      wallet_type: ["TREASURY", "CUSTOMER"],
    },
  },
} as const
