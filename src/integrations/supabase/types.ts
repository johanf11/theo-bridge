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
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          hashed_key: string
          id: string
          last_four: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          hashed_key: string
          id?: string
          last_four: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          hashed_key?: string
          id?: string
          last_four?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          account_name: string
          account_number: string
          bank_name: string
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          routing_code: string | null
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number: string
          bank_name: string
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          routing_code?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_name?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          routing_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      blend_positions: {
        Row: {
          created_at: string
          customer_id: string
          deposited_at: string
          deposited_usdc: number
          fee_bps: number
          gross_apy: number
          id: string
          last_synced_at: string | null
          last_tx_hash: string | null
          net_apy: number
          pool_address: string
          reserve_asset: string
          updated_at: string
          wallet_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          deposited_at?: string
          deposited_usdc?: number
          fee_bps?: number
          gross_apy?: number
          id?: string
          last_synced_at?: string | null
          last_tx_hash?: string | null
          net_apy?: number
          pool_address: string
          reserve_asset?: string
          updated_at?: string
          wallet_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          deposited_at?: string
          deposited_usdc?: number
          fee_bps?: number
          gross_apy?: number
          id?: string
          last_synced_at?: string | null
          last_tx_hash?: string | null
          net_apy?: number
          pool_address?: string
          reserve_asset?: string
          updated_at?: string
          wallet_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          business_type: string | null
          company_name: string
          contact_name: string | null
          corridor_bps: number
          country: string | null
          created_at: string
          email: string
          fee_bps: number
          id: string
          kyb_rejection_reason: string | null
          kyb_requested_changes: string[] | null
          kyb_review_notes: string | null
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
          corridor_bps?: number
          country?: string | null
          created_at?: string
          email: string
          fee_bps?: number
          id?: string
          kyb_rejection_reason?: string | null
          kyb_requested_changes?: string[] | null
          kyb_review_notes?: string | null
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
          corridor_bps?: number
          country?: string | null
          created_at?: string
          email?: string
          fee_bps?: number
          id?: string
          kyb_rejection_reason?: string | null
          kyb_requested_changes?: string[] | null
          kyb_review_notes?: string | null
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      federation_addresses: {
        Row: {
          alias: string
          created_at: string | null
          customer_id: string
          id: string
          memo: string | null
          memo_type: string | null
          stellar_address: string
        }
        Insert: {
          alias: string
          created_at?: string | null
          customer_id: string
          id?: string
          memo?: string | null
          memo_type?: string | null
          stellar_address: string
        }
        Update: {
          alias?: string
          created_at?: string | null
          customer_id?: string
          id?: string
          memo?: string | null
          memo_type?: string | null
          stellar_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "federation_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_email: string | null
          client_name: string
          created_at: string
          currency: string
          customer_id: string
          discount_type: string | null
          discount_value: number
          due_date: string | null
          id: string
          invoice_number: string
          line_items: Json
          note: string | null
          paid_at: string | null
          payment_wallet_id: string | null
          share_token: string
          share_token_expires_at: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          client_email?: string | null
          client_name: string
          created_at?: string
          currency?: string
          customer_id: string
          discount_type?: string | null
          discount_value?: number
          due_date?: string | null
          id?: string
          invoice_number: string
          line_items?: Json
          note?: string | null
          paid_at?: string | null
          payment_wallet_id?: string | null
          share_token?: string
          share_token_expires_at?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          client_email?: string | null
          client_name?: string
          created_at?: string
          currency?: string
          customer_id?: string
          discount_type?: string | null
          discount_value?: number
          due_date?: string | null
          id?: string
          invoice_number?: string
          line_items?: Json
          note?: string | null
          paid_at?: string | null
          payment_wallet_id?: string | null
          share_token?: string
          share_token_expires_at?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_payment_wallet_id_fkey"
            columns: ["payment_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
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
      ledger_accounts: {
        Row: {
          code: string
          created_at: string
          currency: string
          customer_id: string | null
          id: string
          name: string
          type: Database["public"]["Enums"]["ledger_account_type"]
        }
        Insert: {
          code: string
          created_at?: string
          currency: string
          customer_id?: string | null
          id?: string
          name: string
          type: Database["public"]["Enums"]["ledger_account_type"]
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["ledger_account_type"]
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          currency: string
          customer_id: string | null
          debit: number
          id: string
          transaction_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          currency: string
          customer_id?: string | null
          debit?: number
          id?: string
          transaction_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          currency?: string
          customer_id?: string | null
          debit?: number
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_posting_failures: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          payload: Json
          reason: string
          resolution_tx_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: string
          stellar_tx_hash: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          payload: Json
          reason: string
          resolution_tx_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source: string
          stellar_tx_hash?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          payload?: Json
          reason?: string
          resolution_tx_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          stellar_tx_hash?: string | null
        }
        Relationships: []
      }
      ledger_transactions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          kind: string
          order_id: string | null
          posted_by: string | null
          source_key: string | null
          stellar_tx_hash: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          order_id?: string | null
          posted_by?: string | null
          source_key?: string | null
          stellar_tx_hash?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          order_id?: string | null
          posted_by?: string | null
          source_key?: string | null
          stellar_tx_hash?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          completed_at: string | null
          corridor_bps: number | null
          created_at: string
          customer_id: string
          destination_stellar_address: string | null
          destination_wallet_address: string | null
          failure_reason: string | null
          fee_bps: number | null
          fee_usdc: number | null
          forward_premium: number
          funded_at: string | null
          htg_amount: number
          id: string
          margin: number
          order_kind: Database["public"]["Enums"]["order_kind"]
          payout_memo: string | null
          payout_memo_type: string | null
          quote_expires_at: string
          rate: number | null
          reference_number: string
          released_at: string | null
          spot_rate: number | null
          status: Database["public"]["Enums"]["order_status"]
          stellar_tx_hash: string | null
          swap_direction: string | null
          theo_fee_bps: number | null
          theo_fee_usdc: number | null
          updated_at: string
          usdc_amount: number | null
          usdc_gross: number | null
          user_id: string | null
          wallet_id: string | null
        }
        Insert: {
          completed_at?: string | null
          corridor_bps?: number | null
          created_at?: string
          customer_id: string
          destination_stellar_address?: string | null
          destination_wallet_address?: string | null
          failure_reason?: string | null
          fee_bps?: number | null
          fee_usdc?: number | null
          forward_premium?: number
          funded_at?: string | null
          htg_amount: number
          id?: string
          margin?: number
          order_kind?: Database["public"]["Enums"]["order_kind"]
          payout_memo?: string | null
          payout_memo_type?: string | null
          quote_expires_at?: string
          rate?: number | null
          reference_number: string
          released_at?: string | null
          spot_rate?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          stellar_tx_hash?: string | null
          swap_direction?: string | null
          theo_fee_bps?: number | null
          theo_fee_usdc?: number | null
          updated_at?: string
          usdc_amount?: number | null
          usdc_gross?: number | null
          user_id?: string | null
          wallet_id?: string | null
        }
        Update: {
          completed_at?: string | null
          corridor_bps?: number | null
          created_at?: string
          customer_id?: string
          destination_stellar_address?: string | null
          destination_wallet_address?: string | null
          failure_reason?: string | null
          fee_bps?: number | null
          fee_usdc?: number | null
          forward_premium?: number
          funded_at?: string | null
          htg_amount?: number
          id?: string
          margin?: number
          order_kind?: Database["public"]["Enums"]["order_kind"]
          payout_memo?: string | null
          payout_memo_type?: string | null
          quote_expires_at?: string
          rate?: number | null
          reference_number?: string
          released_at?: string | null
          spot_rate?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          stellar_tx_hash?: string | null
          swap_direction?: string | null
          theo_fee_bps?: number | null
          theo_fee_usdc?: number | null
          updated_at?: string
          usdc_amount?: number | null
          usdc_gross?: number | null
          user_id?: string | null
          wallet_id?: string | null
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
      org_members: {
        Row: {
          accepted_at: string | null
          customer_id: string
          email: string
          id: string
          invited_at: string
          role_id: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          customer_id: string
          email: string
          id?: string
          invited_at?: string
          role_id: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          customer_id?: string
          email?: string
          id?: string
          invited_at?: string
          role_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_roles: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_system: boolean
          name: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_system?: boolean
          name: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_system?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_roles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_usdc: number
          asset_code: string
          completed_at: string | null
          created_at: string
          customer_id: string
          failure_reason: string | null
          id: string
          memo: string | null
          memo_type: string | null
          recipient_address: string
          recipient_name: string
          source_wallet_id: string | null
          status: Database["public"]["Enums"]["payout_status"]
          stellar_tx_hash: string | null
          user_id: string | null
        }
        Insert: {
          amount_usdc: number
          asset_code?: string
          completed_at?: string | null
          created_at?: string
          customer_id: string
          failure_reason?: string | null
          id?: string
          memo?: string | null
          memo_type?: string | null
          recipient_address: string
          recipient_name: string
          source_wallet_id?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          stellar_tx_hash?: string | null
          user_id?: string | null
        }
        Update: {
          amount_usdc?: number
          asset_code?: string
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          failure_reason?: string | null
          id?: string
          memo?: string | null
          memo_type?: string | null
          recipient_address?: string
          recipient_name?: string
          source_wallet_id?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          stellar_tx_hash?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payouts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_source_wallet_id_fkey"
            columns: ["source_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
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
      reserve_attestations: {
        Row: {
          attestation_pdf_url: string | null
          attested_at: string
          auditor_name: string | null
          created_at: string
          htg_balance: number
          id: string
          period_label: string
          updated_at: string
        }
        Insert: {
          attestation_pdf_url?: string | null
          attested_at: string
          auditor_name?: string | null
          created_at?: string
          htg_balance: number
          id?: string
          period_label: string
          updated_at?: string
        }
        Update: {
          attestation_pdf_url?: string | null
          attested_at?: string
          auditor_name?: string | null
          created_at?: string
          htg_balance?: number
          id?: string
          period_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          enabled: boolean
          id: string
          permission: Database["public"]["Enums"]["org_permission"]
          role_id: string
        }
        Insert: {
          enabled?: boolean
          id?: string
          permission: Database["public"]["Enums"]["org_permission"]
          role_id: string
        }
        Update: {
          enabled?: boolean
          id?: string
          permission?: Database["public"]["Enums"]["org_permission"]
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_recipients: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          label: string | null
          memo: string | null
          memo_type: string | null
          name: string
          stellar_address: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          label?: string | null
          memo?: string | null
          memo_type?: string | null
          name: string
          stellar_address: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          label?: string | null
          memo?: string | null
          memo_type?: string | null
          name?: string
          stellar_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
      vendor_wire_instructions: {
        Row: {
          account_number: string | null
          amount_usdc: number
          bank_name: string | null
          created_at: string
          customer_id: string
          id: string
          note: string | null
          owlting_status: Database["public"]["Enums"]["owlting_wire_status"]
          payout_id: string
          reference: string | null
          simulated_wire_ref: string | null
          swift_bic: string | null
          updated_at: string
          vendor_country: string | null
          vendor_name: string
          wired_at: string | null
        }
        Insert: {
          account_number?: string | null
          amount_usdc: number
          bank_name?: string | null
          created_at?: string
          customer_id: string
          id?: string
          note?: string | null
          owlting_status?: Database["public"]["Enums"]["owlting_wire_status"]
          payout_id: string
          reference?: string | null
          simulated_wire_ref?: string | null
          swift_bic?: string | null
          updated_at?: string
          vendor_country?: string | null
          vendor_name: string
          wired_at?: string | null
        }
        Update: {
          account_number?: string | null
          amount_usdc?: number
          bank_name?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          note?: string | null
          owlting_status?: Database["public"]["Enums"]["owlting_wire_status"]
          payout_id?: string
          reference?: string | null
          simulated_wire_ref?: string | null
          swift_bic?: string | null
          updated_at?: string
          vendor_country?: string | null
          vendor_name?: string
          wired_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_wire_instructions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_wire_instructions_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          created_at: string
          currency: string
          customer_id: string | null
          display_order: number | null
          has_signing_key: boolean | null
          id: string
          label: string | null
          network: string
          stellar_address: string
          stellar_secret: string | null
          updated_at: string
          usdc_balance: number
          wallet_type: Database["public"]["Enums"]["wallet_type"]
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          display_order?: number | null
          has_signing_key?: boolean | null
          id?: string
          label?: string | null
          network?: string
          stellar_address: string
          stellar_secret?: string | null
          updated_at?: string
          usdc_balance?: number
          wallet_type: Database["public"]["Enums"]["wallet_type"]
        }
        Update: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          display_order?: number | null
          has_signing_key?: boolean | null
          id?: string
          label?: string | null
          network?: string
          stellar_address?: string
          stellar_secret?: string | null
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
      _ledger_validate_balance: {
        Args: { p_transaction_id: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_effective_customer_id: { Args: never; Returns: string }
      get_invoice_share_token: {
        Args: { p_invoice_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { p_customer_id: string }; Returns: boolean }
      is_org_owner: { Args: { p_customer_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      post_ledger_entries: { Args: { payload: Json }; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      seed_default_roles: {
        Args: {
          p_customer_id: string
          p_owner_email: string
          p_owner_user_id: string
        }
        Returns: undefined
      }
      setup_daily_tx_cron: { Args: never; Returns: Json }
      setup_fetch_brh_rate_cron: { Args: never; Returns: Json }
      vault_upsert_secret: {
        Args: { p_name: string; p_secret: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "customer"
      job_status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
      job_type: "SPIH_RECONCILE" | "USDC_RELEASE" | "STELLAR_CONFIRM"
      kyb_status:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "UNDER_REVIEW"
        | "CHANGES_REQUESTED"
      ledger_account_type:
        | "ASSET"
        | "LIABILITY"
        | "EQUITY"
        | "REVENUE"
        | "EXPENSE"
      order_kind:
        | "usdc_conversion"
        | "htgc_mint"
        | "htgc_usdc_swap"
        | "htgc_withdrawal"
      order_status:
        | "CREATED"
        | "QUOTED"
        | "FUNDED"
        | "RELEASING"
        | "COMPLETED"
        | "FAILED"
        | "EXPIRED"
        | "REFUNDED"
      org_permission:
        | "convert"
        | "payout_send"
        | "balance_view_keys"
        | "accounts_manage"
        | "view_balances"
      owlting_wire_status: "RECEIVED" | "WIRED" | "FAILED"
      payout_status: "PENDING" | "COMPLETED" | "FAILED"
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
      kyb_status: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "UNDER_REVIEW",
        "CHANGES_REQUESTED",
      ],
      ledger_account_type: [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
      ],
      order_kind: [
        "usdc_conversion",
        "htgc_mint",
        "htgc_usdc_swap",
        "htgc_withdrawal",
      ],
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
      org_permission: [
        "convert",
        "payout_send",
        "balance_view_keys",
        "accounts_manage",
        "view_balances",
      ],
      owlting_wire_status: ["RECEIVED", "WIRED", "FAILED"],
      payout_status: ["PENDING", "COMPLETED", "FAILED"],
      wallet_type: ["TREASURY", "CUSTOMER"],
    },
  },
} as const
