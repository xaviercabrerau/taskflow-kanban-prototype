// Generado desde el esquema real del proyecto Supabase "taskflow"
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
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          task_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          task_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          external_url: string | null
          file_name: string
          file_size_bytes: number | null
          file_url: string
          id: string
          mime_type: string | null
          source: string
          task_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          external_url?: string | null
          file_name: string
          file_size_bytes?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          source?: string
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          external_url?: string | null
          file_name?: string
          file_size_bytes?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          source?: string
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json
          resource_id: string | null
          resource_type: string
          source: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          resource_id?: string | null
          resource_type: string
          source: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          error_message: string | null
          executed_at: string
          id: string
          rule_id: string
          status: string
          task_id: string | null
        }
        Insert: {
          error_message?: string | null
          executed_at?: string
          id?: string
          rule_id: string
          status: string
          task_id?: string | null
        }
        Update: {
          error_message?: string | null
          executed_at?: string
          id?: string
          rule_id?: string
          status?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          actions: Json
          conditions: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          trigger: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          trigger: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          trigger?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      board_columns: {
        Row: {
          board_id: string
          color: string | null
          id: string
          is_done_state: boolean
          key: string
          label: string
          order_index: number
        }
        Insert: {
          board_id: string
          color?: string | null
          id?: string
          is_done_state?: boolean
          key: string
          label: string
          order_index?: number
        }
        Update: {
          board_id?: string
          color?: string | null
          id?: string
          is_done_state?: boolean
          key?: string
          label?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_templates: {
        Row: {
          custom_field_schema: Json
          default_automations: Json
          default_columns: Json
          default_views: string[]
          description: string | null
          id: string
          install_count: number
          is_public: boolean
          name: string
          published_by: string | null
          tenant_id: string | null
        }
        Insert: {
          custom_field_schema?: Json
          default_automations?: Json
          default_columns?: Json
          default_views?: string[]
          description?: string | null
          id?: string
          install_count?: number
          is_public?: boolean
          name: string
          published_by?: string | null
          tenant_id?: string | null
        }
        Update: {
          custom_field_schema?: Json
          default_automations?: Json
          default_columns?: Json
          default_views?: string[]
          description?: string | null
          id?: string
          install_count?: number
          is_public?: boolean
          name?: string
          published_by?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          tenant_id: string
          workspace_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          checklist_id: string
          created_at: string
          id: string
          is_done: boolean
          label: string
          order_index: number
        }
        Insert: {
          checklist_id: string
          created_at?: string
          id?: string
          is_done?: boolean
          label: string
          order_index?: number
        }
        Update: {
          checklist_id?: string
          created_at?: string
          id?: string
          is_done?: boolean
          label?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          created_at: string
          id: string
          order_index: number
          task_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_index?: number
          task_id: string
          title?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_index?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          edited_at: string | null
          id: string
          mentioned_user_ids: string[]
          parent_comment_id: string | null
          source: string
          task_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mentioned_user_ids?: string[]
          parent_comment_id?: string | null
          source?: string
          task_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mentioned_user_ids?: string[]
          parent_comment_id?: string | null
          source?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          board_id: string
          field_type: string
          id: string
          is_required: boolean
          key: string
          label: string
          options: Json | null
          order_index: number
        }
        Insert: {
          board_id: string
          field_type: string
          id?: string
          is_required?: boolean
          key: string
          label: string
          options?: Json | null
          order_index?: number
        }
        Update: {
          board_id?: string
          field_type?: string
          id?: string
          is_required?: boolean
          key?: string
          label?: string
          options?: Json | null
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          created_at: string
          gmail_thread_id: string | null
          id: string
          message_id: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gmail_thread_id?: string | null
          id?: string
          message_id: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          gmail_thread_id?: string | null
          id?: string
          message_id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      epics: {
        Row: {
          board_id: string
          color: string | null
          id: string
          name: string
          status: string | null
        }
        Insert: {
          board_id: string
          color?: string | null
          id?: string
          name: string
          status?: string | null
        }
        Update: {
          board_id?: string
          color?: string | null
          id?: string
          name?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "epics_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_jobs: {
        Row: {
          created_at: string
          error_message: string
          event_type: string | null
          id: string
          retry_count: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          event_type?: string | null
          id?: string
          retry_count?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          event_type?: string | null
          id?: string
          retry_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      integrations: {
        Row: {
          config: Json
          created_at: string
          credentials_enc: string | null
          id: string
          is_active: boolean
          provider: string
          tenant_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          credentials_enc?: string | null
          id?: string
          is_active?: boolean
          provider: string
          tenant_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          credentials_enc?: string | null
          id?: string
          is_active?: boolean
          provider?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_sessions: {
        Row: {
          client: string
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          tenant_id: string
          token_hash: string | null
          token_scopes: string[]
          user_id: string
        }
        Insert: {
          client: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          tenant_id: string
          token_hash?: string | null
          token_scopes?: string[]
          user_id: string
        }
        Update: {
          client?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string | null
          token_scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics_snapshots: {
        Row: {
          board_id: string
          id: string
          metric_type: string
          snapshot_date: string
          sprint_id: string | null
          value: Json
        }
        Insert: {
          board_id: string
          id?: string
          metric_type: string
          snapshot_date: string
          sprint_id?: string | null
          value?: Json
        }
        Update: {
          board_id?: string
          id?: string
          metric_type?: string
          snapshot_date?: string
          sprint_id?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "metrics_snapshots_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_snapshots_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          event_type: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          event_type: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          event_type?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          related_task_id: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          related_task_id?: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          related_task_id?: string | null
          tenant_id?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          org_role: string
          organization_id: string
          user_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_role?: string
          organization_id: string
          user_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_role?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          audit_retention_days: number
          created_at: string
          id: string
          mcp_tokens_enabled: boolean
          mfa_required: boolean
          name: string
          owner_id: string | null
          plan: string
          settings: Json
          slug: string
          sso_domain: string | null
          sso_enabled: boolean
          updated_at: string
        }
        Insert: {
          audit_retention_days?: number
          created_at?: string
          id?: string
          mcp_tokens_enabled?: boolean
          mfa_required?: boolean
          name: string
          owner_id?: string | null
          plan?: string
          settings?: Json
          slug: string
          sso_domain?: string | null
          sso_enabled?: boolean
          updated_at?: string
        }
        Update: {
          audit_retention_days?: number
          created_at?: string
          id?: string
          mcp_tokens_enabled?: boolean
          mfa_required?: boolean
          name?: string
          owner_id?: string | null
          plan?: string
          settings?: Json
          slug?: string
          sso_domain?: string | null
          sso_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          category: string
          description: string | null
          id: string
          key: string
        }
        Insert: {
          category: string
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          category?: string
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_login_at: string | null
          status: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_login_at?: string | null
          status?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          status?: string
        }
        Relationships: []
      }
      role_assignments: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role_id: string
          scope_id: string
          scope_type: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role_id: string
          scope_id: string
          scope_type: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role_id?: string
          scope_id?: string
          scope_type?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          id: string
          is_system: boolean
          name: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          board_id: string
          created_at: string
          filters: Json
          id: string
          name: string
          user_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          filters?: Json
          id?: string
          name: string
          user_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          board_id: string
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          status: string
        }
        Insert: {
          board_id: string
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: string
        }
        Update: {
          board_id?: string
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprints_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          task_id: string
          user_id: string
        }
        Insert: {
          task_id: string
          user_id: string
        }
        Update: {
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_links: {
        Row: {
          id: string
          link_type: string
          source_task_id: string
          target_task_id: string
        }
        Insert: {
          id?: string
          link_type: string
          source_task_id: string
          target_task_id: string
        }
        Update: {
          id?: string
          link_type?: string
          source_task_id?: string
          target_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_links_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_links_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_tags: {
        Row: {
          tag_id: string
          task_id: string
        }
        Insert: {
          tag_id: string
          task_id: string
        }
        Update: {
          tag_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tags_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_name: string | null
          assignee_user_id: string | null
          board_id: string
          column_entered_at: string
          column_id: string
          created_at: string
          created_by: string | null
          custom_fields: Json
          description: string | null
          due_date: string | null
          due_soon_notified_at: string | null
          epic_id: string | null
          id: string
          meet_event_id: string | null
          meet_link: string | null
          meet_scheduled_at: string | null
          parent_task_id: string | null
          position: number
          priority: string
          sprint_id: string | null
          start_date: string | null
          story_points: number | null
          tag: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_name?: string | null
          assignee_user_id?: string | null
          board_id: string
          column_entered_at?: string
          column_id: string
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          description?: string | null
          due_date?: string | null
          due_soon_notified_at?: string | null
          epic_id?: string | null
          id?: string
          meet_event_id?: string | null
          meet_link?: string | null
          meet_scheduled_at?: string | null
          parent_task_id?: string | null
          position?: number
          priority?: string
          sprint_id?: string | null
          start_date?: string | null
          story_points?: number | null
          tag?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_name?: string | null
          assignee_user_id?: string | null
          board_id?: string
          column_entered_at?: string
          column_id?: string
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          description?: string | null
          due_date?: string | null
          due_soon_notified_at?: string | null
          epic_id?: string | null
          id?: string
          meet_event_id?: string | null
          meet_link?: string | null
          meet_scheduled_at?: string | null
          parent_task_id?: string | null
          position?: number
          priority?: string
          sprint_id?: string | null
          start_date?: string | null
          story_points?: number | null
          tag?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "board_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_epic_id_fkey"
            columns: ["epic_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_installs: {
        Row: {
          installed_at: string
          template_id: string
          user_id: string
        }
        Insert: {
          installed_at?: string
          template_id: string
          user_id: string
        }
        Update: {
          installed_at?: string
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_installs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "board_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks_inbound: {
        Row: {
          board_id: string
          column_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          tenant_id: string
          token_hash: string
        }
        Insert: {
          board_id: string
          column_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          tenant_id: string
          token_hash: string
        }
        Update: {
          board_id?: string
          column_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_inbound_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_inbound_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "board_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_inbound_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks_outbound: {
        Row: {
          event_type: string
          id: string
          is_active: boolean
          secret_hash: string
          target_url: string
          tenant_id: string
        }
        Insert: {
          event_type: string
          id?: string
          is_active?: boolean
          secret_hash: string
          target_url: string
          tenant_id: string
        }
        Update: {
          event_type?: string
          id?: string
          is_active?: boolean
          secret_hash?: string
          target_url?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_outbound_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          template_id: string | null
          tenant_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          template_id?: string | null
          tenant_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          template_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "board_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      automation_conditions_match: {
        Args: {
          conditions: Json
          p_assignee_name: string
          p_priority: string
          p_tag: string
          p_title: string
        }
        Returns: boolean
      }
      check_due_soon_tasks: { Args: never; Returns: undefined }
      create_inbound_webhook: {
        Args: { p_board_id: string; p_column_id: string; p_tenant_id: string }
        Returns: {
          board_id: string
          column_id: string
          created_at: string
          id: string
          is_active: boolean
          token: string
        }[]
      }
      create_mcp_session: {
        Args: { p_client: string; p_name: string; p_scopes: string[] }
        Returns: {
          session_id: string
          token: string
        }[]
      }
      create_organization: {
        Args: { org_name: string; org_slug: string }
        Returns: {
          audit_retention_days: number
          created_at: string
          id: string
          mcp_tokens_enabled: boolean
          mfa_required: boolean
          name: string
          owner_id: string | null
          plan: string
          settings: Json
          slug: string
          sso_domain: string | null
          sso_enabled: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      execute_due_date_automations: { Args: never; Returns: undefined }
      execute_sla_automations: { Args: never; Returns: undefined }
      get_cron_health: {
        Args: never
        Returns: {
          expected_interval: string
          is_stale: boolean
          job_name: string
          last_run_at: string
          last_status: string
        }[]
      }
      get_google_refresh_token: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      has_permission: {
        Args: { bid: string; perm_key: string }
        Returns: boolean
      }
      has_permission_as: {
        Args: { bid: string; perm_key: string; uid: string }
        Returns: boolean
      }
      increment_template_install_count: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      ingest_webhook_task: {
        Args: {
          p_description?: string
          p_due_date?: string
          p_priority?: string
          p_title: string
          p_token: string
        }
        Returns: string
      }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      is_org_owner: { Args: { org_id: string }; Returns: boolean }
      is_safe_webhook_url: { Args: { url: string }; Returns: boolean }
      list_org_members: {
        Args: { org_id: string }
        Returns: {
          email: string
          full_name: string
          member_user_id: string
          membership_id: string
          org_role: string
        }[]
      }
      mcp_add_comment: {
        Args: { p_body: string; p_task_id: string; p_token: string }
        Returns: string
      }
      mcp_create_task: {
        Args: {
          p_board_name?: string
          p_due_date?: string
          p_priority?: string
          p_title: string
          p_token: string
        }
        Returns: string
      }
      mcp_list_tasks: {
        Args: { p_token: string }
        Returns: {
          assignee_name: string
          board_name: string
          column_label: string
          due_date: string
          id: string
          priority: string
          title: string
        }[]
      }
      mcp_move_task: {
        Args: { p_column_label: string; p_task_id: string; p_token: string }
        Returns: undefined
      }
      my_permissions: { Args: { bid: string }; Returns: string[] }
      purge_expired_audit_logs: { Args: never; Returns: undefined }
      record_daily_metrics_snapshot: {
        Args: { p_board_id: string }
        Returns: undefined
      }
      record_daily_metrics_snapshot_all_boards: {
        Args: never
        Returns: undefined
      }
      record_daily_metrics_snapshot_core: {
        Args: { p_board_id: string }
        Returns: undefined
      }
      remove_integration: {
        Args: { p_integration_id: string }
        Returns: undefined
      }
      revoke_mcp_session: { Args: { p_session_id: string }; Returns: undefined }
      search_profile_by_email: {
        Args: { p_email: string }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      session_meets_mfa: { Args: { org_id: string }; Returns: boolean }
      upsert_integration: {
        Args: {
          p_config: Json
          p_is_active: boolean
          p_provider: string
          p_secret: string
          p_tenant_id: string
        }
        Returns: undefined
      }
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
