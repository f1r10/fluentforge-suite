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
      activity_events: {
        Row: {
          attempt_id: string | null
          category: string
          created_at: string
          details: Json
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: number
          is_correct: boolean | null
          response: Json | null
          student_id: string | null
        }
        Insert: {
          attempt_id?: string | null
          category?: string
          created_at?: string
          details?: Json
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: never
          is_correct?: boolean | null
          response?: Json | null
          student_id?: string | null
        }
        Update: {
          attempt_id?: string | null
          category?: string
          created_at?: string
          details?: Json
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: never
          is_correct?: boolean | null
          response?: Json | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_recovery_codes: {
        Row: {
          admin_id: string
          code_hash: string
          created_at: string
          id: string
          invalidated_at: string | null
          set_id: string
          used_at: string | null
        }
        Insert: {
          admin_id: string
          code_hash: string
          created_at?: string
          id?: string
          invalidated_at?: string | null
          set_id: string
          used_at?: string | null
        }
        Update: {
          admin_id?: string
          code_hash?: string
          created_at?: string
          id?: string
          invalidated_at?: string | null
          set_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_recovery_codes_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          auth_user_id: string
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          username: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          username: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      attempt_answers: {
        Row: {
          attempt_id: string
          auto_score: number | null
          change_count: number
          flagged: boolean
          id: string
          is_correct: boolean | null
          item_key: string
          question_id: string | null
          question_version: number | null
          response: Json | null
          score: number | null
          time_spent_ms: number
          updated_at: string
        }
        Insert: {
          attempt_id: string
          auto_score?: number | null
          change_count?: number
          flagged?: boolean
          id?: string
          is_correct?: boolean | null
          item_key: string
          question_id?: string | null
          question_version?: number | null
          response?: Json | null
          score?: number | null
          time_spent_ms?: number
          updated_at?: string
        }
        Update: {
          attempt_id?: string
          auto_score?: number | null
          change_count?: number
          flagged?: boolean
          id?: string
          is_correct?: boolean | null
          item_key?: string
          question_id?: string | null
          question_version?: number | null
          response?: Json | null
          score?: number | null
          time_spent_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempt_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string | null
          id: number
          ip: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          summary?: string | null
        }
        Relationships: []
      }
      backups: {
        Row: {
          checksum_sha256: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          last_restored_at: string | null
          manifest: Json
          mime_type: string | null
          restore_state: Json
          size_bytes: number | null
          status: Database["public"]["Enums"]["job_status"]
          storage_path: string | null
        }
        Insert: {
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          last_restored_at?: string | null
          manifest?: Json
          mime_type?: string | null
          restore_state?: Json
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
        }
        Update: {
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          last_restored_at?: string | null
          manifest?: Json
          mime_type?: string | null
          restore_state?: Json
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
        }
        Relationships: []
      }
      catalog_assignments: {
        Row: {
          catalog_id: string
          created_at: string
          group_id: string | null
          id: string
          student_id: string | null
        }
        Insert: {
          catalog_id: string
          created_at?: string
          group_id?: string | null
          id?: string
          student_id?: string | null
        }
        Update: {
          catalog_id?: string
          created_at?: string
          group_id?: string | null
          id?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_assignments_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          catalog_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          sort_order: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          sort_order?: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogs: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          parent_id: string | null
          settings: Json
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          settings?: Json
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          settings?: Json
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogs_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "catalogs"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_assignments: {
        Row: {
          created_at: string
          exam_id: string
          group_id: string | null
          id: string
          student_id: string | null
        }
        Insert: {
          created_at?: string
          exam_id: string
          group_id?: string | null
          id?: string
          student_id?: string | null
        }
        Update: {
          created_at?: string
          exam_id?: string
          group_id?: string | null
          id?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_assignments_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          deadline_at: string | null
          exam_id: string
          id: string
          max_score: number | null
          passed: boolean | null
          result_released: boolean
          reset_at: string | null
          reset_by: string | null
          score: number | null
          snapshot: Json
          started_at: string
          status: Database["public"]["Enums"]["attempt_status"]
          student_id: string
          submitted_at: string | null
          violations: Json
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          deadline_at?: string | null
          exam_id: string
          id?: string
          max_score?: number | null
          passed?: boolean | null
          result_released?: boolean
          reset_at?: string | null
          reset_by?: string | null
          score?: number | null
          snapshot: Json
          started_at?: string
          status?: Database["public"]["Enums"]["attempt_status"]
          student_id: string
          submitted_at?: string | null
          violations?: Json
        }
        Update: {
          attempt_number?: number
          created_at?: string
          deadline_at?: string | null
          exam_id?: string
          id?: string
          max_score?: number | null
          passed?: boolean | null
          result_released?: boolean
          reset_at?: string | null
          reset_by?: string | null
          score?: number | null
          snapshot?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["attempt_status"]
          student_id?: string
          submitted_at?: string | null
          violations?: Json
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_items: {
        Row: {
          entity_id: string | null
          entity_type: string
          exam_id: string
          id: string
          points: number | null
          question_version: number | null
          section_id: string | null
          sort_order: number
        }
        Insert: {
          entity_id?: string | null
          entity_type: string
          exam_id: string
          id?: string
          points?: number | null
          question_version?: number | null
          section_id?: string | null
          sort_order?: number
        }
        Update: {
          entity_id?: string | null
          entity_type?: string
          exam_id?: string
          id?: string
          points?: number | null
          question_version?: number | null
          section_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_items_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "exam_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_listening_plays: {
        Row: {
          attempt_id: string
          completed_at: string | null
          expires_at: string
          id: string
          listening_id: string
          play_number: number
          request_id: string
          started_at: string
          stream_token_hash: string | null
          student_id: string
        }
        Insert: {
          attempt_id: string
          completed_at?: string | null
          expires_at: string
          id?: string
          listening_id: string
          play_number: number
          request_id: string
          started_at?: string
          stream_token_hash?: string | null
          student_id: string
        }
        Update: {
          attempt_id?: string
          completed_at?: string | null
          expires_at?: string
          id?: string
          listening_id?: string
          play_number?: number
          request_id?: string
          started_at?: string
          stream_token_hash?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_listening_plays_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_listening_plays_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_sections: {
        Row: {
          exam_id: string
          id: string
          instructions: string | null
          pool_rules: Json | null
          sort_order: number
          title: string | null
        }
        Insert: {
          exam_id: string
          id?: string
          instructions?: string | null
          pool_rules?: Json | null
          sort_order?: number
          title?: string | null
        }
        Update: {
          exam_id?: string
          id?: string
          instructions?: string | null
          pool_rules?: Json | null
          sort_order?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_sections_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          available_from: string | null
          available_until: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          duration_minutes: number | null
          id: string
          published_at: string | null
          published_snapshot: Json | null
          settings: Json
          status: Database["public"]["Enums"]["exam_status"]
          title: string
          updated_at: string
        }
        Insert: {
          available_from?: string | null
          available_until?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          published_at?: string | null
          published_snapshot?: Json | null
          settings?: Json
          status?: Database["public"]["Enums"]["exam_status"]
          title: string
          updated_at?: string
        }
        Update: {
          available_from?: string | null
          available_until?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          published_at?: string | null
          published_snapshot?: Json | null
          settings?: Json
          status?: Database["public"]["Enums"]["exam_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          expires_at: string
          format: string
          id: string
          include_trash: boolean
          kind: string
          mime_type: string | null
          params: Json
          row_counts: Json
          size_bytes: number | null
          status: Database["public"]["Enums"]["job_status"]
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          expires_at?: string
          format: string
          id?: string
          include_trash?: boolean
          kind: string
          mime_type?: string | null
          params?: Json
          row_counts?: Json
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          expires_at?: string
          format?: string
          id?: string
          include_trash?: boolean
          kind?: string
          mime_type?: string | null
          params?: Json
          row_counts?: Json
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          student_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          student_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memberships: {
        Row: {
          created_at: string
          group_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          student_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_items: {
        Row: {
          confidence: number | null
          created_at: string
          created_entity_id: string | null
          crop: Json | null
          decision: string
          duplicate_kind: string | null
          duplicate_of: string | null
          id: string
          item_type: string
          job_id: string
          page: number | null
          payload: Json
          sheet: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_entity_id?: string | null
          crop?: Json | null
          decision?: string
          duplicate_kind?: string | null
          duplicate_of?: string | null
          id?: string
          item_type: string
          job_id: string
          page?: number | null
          payload?: Json
          sheet?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_entity_id?: string | null
          crop?: Json | null
          decision?: string
          duplicate_kind?: string | null
          duplicate_of?: string | null
          id?: string
          item_type?: string
          job_id?: string
          page?: number | null
          payload?: Json
          sheet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          error: string | null
          extraction_method: string | null
          id: string
          mode: string
          profile_id: string | null
          progress: number
          processor_job_id: string | null
          source_file_id: string | null
          stats: Json
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          extraction_method?: string | null
          id?: string
          mode?: string
          profile_id?: string | null
          progress?: number
          processor_job_id?: string | null
          source_file_id?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          extraction_method?: string | null
          id?: string
          mode?: string
          profile_id?: string | null
          progress?: number
          processor_job_id?: string | null
          source_file_id?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "import_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      import_profiles: {
        Row: {
          config: Json
          created_at: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          name: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: []
      }
      languages: {
        Row: {
          code: string
          is_interface: boolean
          is_learning: boolean
          is_translation: boolean
          name: string
          native_name: string | null
          sort_order: number
        }
        Insert: {
          code: string
          is_interface?: boolean
          is_learning?: boolean
          is_translation?: boolean
          name: string
          native_name?: string | null
          sort_order?: number
        }
        Update: {
          code?: string
          is_interface?: boolean
          is_learning?: boolean
          is_translation?: boolean
          name?: string
          native_name?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      listening_question_sets: {
        Row: {
          id: string
          instructions: string | null
          listening_id: string
          section_id: string | null
          sort_order: number
          title: string | null
        }
        Insert: {
          id?: string
          instructions?: string | null
          listening_id: string
          section_id?: string | null
          sort_order?: number
          title?: string | null
        }
        Update: {
          id?: string
          instructions?: string | null
          listening_id?: string
          section_id?: string | null
          sort_order?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listening_question_sets_listening_id_fkey"
            columns: ["listening_id"]
            isOneToOne: false
            referencedRelation: "listenings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listening_question_sets_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "listening_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      listening_sections: {
        Row: {
          end_seconds: number | null
          id: string
          listening_id: string
          sort_order: number
          start_seconds: number | null
          title: string | null
        }
        Insert: {
          end_seconds?: number | null
          id?: string
          listening_id: string
          sort_order?: number
          start_seconds?: number | null
          title?: string | null
        }
        Update: {
          end_seconds?: number | null
          id?: string
          listening_id?: string
          sort_order?: number
          start_seconds?: number | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listening_sections_listening_id_fkey"
            columns: ["listening_id"]
            isOneToOne: false
            referencedRelation: "listenings"
            referencedColumns: ["id"]
          },
        ]
      }
      listenings: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          learning_language: string | null
          level: string | null
          media_id: string | null
          metadata: Json
          playback_rules: Json
          source_file_id: string | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          transcript: string | null
          transcript_segments: Json | null
          transcript_source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          learning_language?: string | null
          level?: string | null
          media_id?: string | null
          metadata?: Json
          playback_rules?: Json
          source_file_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          transcript?: string | null
          transcript_segments?: Json | null
          transcript_source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          learning_language?: string | null
          level?: string | null
          media_id?: string | null
          metadata?: Json
          playback_rules?: Json
          source_file_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          transcript?: string | null
          transcript_segments?: Json | null
          transcript_source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listenings_learning_language_fkey"
            columns: ["learning_language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "listenings_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listenings_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          created_at: string
          id: number
          identifier: string
          ip: string | null
          kind: string
          success: boolean
        }
        Insert: {
          created_at?: string
          id?: never
          identifier: string
          ip?: string | null
          kind: string
          success: boolean
        }
        Update: {
          created_at?: string
          id?: never
          identifier?: string
          ip?: string | null
          kind?: string
          success?: boolean
        }
        Relationships: []
      }
      manual_reviews: {
        Row: {
          ai_suggestion: Json | null
          answer_id: string | null
          created_at: string
          final_score: number | null
          id: string
          question_id: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["review_status"]
          student_id: string | null
        }
        Insert: {
          ai_suggestion?: Json | null
          answer_id?: string | null
          created_at?: string
          final_score?: number | null
          id?: string
          question_id?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          student_id?: string | null
        }
        Update: {
          ai_suggestion?: Json | null
          answer_id?: string | null
          created_at?: string
          final_score?: number | null
          id?: string
          question_id?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_reviews_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "attempt_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      media_upload_sessions: {
        Row: {
          id: string
          storage_path: string
          kind: Database["public"]["Enums"]["media_kind"]
          original_filename: string
          mime_type: string | null
          expected_size_bytes: number
          created_at: string
          expires_at: string
          finalized_at: string | null
          media_asset_id: string | null
        }
        Insert: {
          id?: string
          storage_path: string
          kind: Database["public"]["Enums"]["media_kind"]
          original_filename: string
          mime_type?: string | null
          expected_size_bytes: number
          created_at?: string
          expires_at: string
          finalized_at?: string | null
          media_asset_id?: string | null
        }
        Update: {
          id?: string
          storage_path?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          original_filename?: string
          mime_type?: string | null
          expected_size_bytes?: number
          created_at?: string
          expires_at?: string
          finalized_at?: string | null
          media_asset_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_upload_sessions_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          checksum: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          external_url: string | null
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          metadata: Json
          mime_type: string | null
          original_filename: string | null
          size_bytes: number | null
          storage_path: string | null
          width: number | null
        }
        Insert: {
          checksum?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          external_url?: string | null
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["media_kind"]
          metadata?: Json
          mime_type?: string | null
          original_filename?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          width?: number | null
        }
        Update: {
          checksum?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          external_url?: string | null
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          metadata?: Json
          mime_type?: string | null
          original_filename?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          width?: number | null
        }
        Relationships: []
      }
      media_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          media_asset_id: string | null
          processor_job_id: string | null
          progress: number
          result: Json
          rights_confirmed_at: string
          source_kind: string
          source_url: string
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          media_asset_id?: string | null
          processor_job_id?: string | null
          progress?: number
          result?: Json
          rights_confirmed_at: string
          source_kind: string
          source_url: string
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          media_asset_id?: string | null
          processor_job_id?: string | null
          progress?: number
          result?: Json
          rights_confirmed_at?: string
          source_kind?: string
          source_url?: string
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_import_jobs_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          dedupe_key: string | null
          id: string
          kind: string
          link: string | null
          read_at: string | null
          recipient_type: string
          student_id: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          recipient_type: string
          student_id?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          recipient_type?: string
          student_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      question_reports: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          question_id: string
          resolved_at: string | null
          student_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          question_id: string
          resolved_at?: string | null
          student_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          question_id?: string
          resolved_at?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_reports_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      question_tags: {
        Row: {
          question_id: string
          tag_id: string
        }
        Insert: {
          question_id: string
          tag_id: string
        }
        Update: {
          question_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_tags_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      question_topics: {
        Row: {
          question_id: string
          topic_id: string
        }
        Insert: {
          question_id: string
          topic_id: string
        }
        Update: {
          question_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_topics_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      question_versions: {
        Row: {
          created_at: string
          id: string
          question_id: string
          snapshot: Json
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          question_id: string
          snapshot: Json
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          question_id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_versions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          id: string
          kind: string
          entity_type: string | null
          entity_id: string | null
          processor_job_id: string
          status: Database["public"]["Enums"]["job_status"]
          progress: number
          params: Json
          result: Json
          error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          kind: string
          entity_type?: string | null
          entity_id?: string | null
          processor_job_id: string
          status?: Database["public"]["Enums"]["job_status"]
          progress?: number
          params?: Json
          result?: Json
          error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          kind?: string
          entity_type?: string | null
          entity_id?: string | null
          processor_job_id?: string
          status?: Database["public"]["Enums"]["job_status"]
          progress?: number
          params?: Json
          result?: Json
          error?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          answer_key: Json
          content_hash: string | null
          context_kind: Database["public"]["Enums"]["context_kind"]
          context_sort: number
          created_at: string
          current_version: number
          deleted_at: string | null
          difficulty: number | null
          explanation: string | null
          grading_mode: string
          id: string
          import_job_id: string | null
          instructions: string | null
          learning_language: string | null
          level: string | null
          listening_question_set_id: string | null
          media_id: string | null
          normalization: Json
          payload: Json
          prompt: string
          provenance: Json
          question_type: string
          reading_question_set_id: string | null
          reusable_independently: boolean
          scoring: Json
          search: unknown
          source_file_id: string | null
          source_page: number | null
          source_sheet: string | null
          status: Database["public"]["Enums"]["content_status"]
          teacher_notes: string | null
          updated_at: string
        }
        Insert: {
          answer_key?: Json
          content_hash?: string | null
          context_kind?: Database["public"]["Enums"]["context_kind"]
          context_sort?: number
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          difficulty?: number | null
          explanation?: string | null
          grading_mode?: string
          id?: string
          import_job_id?: string | null
          instructions?: string | null
          learning_language?: string | null
          level?: string | null
          listening_question_set_id?: string | null
          media_id?: string | null
          normalization?: Json
          payload?: Json
          prompt?: string
          provenance?: Json
          question_type: string
          reading_question_set_id?: string | null
          reusable_independently?: boolean
          scoring?: Json
          search?: unknown
          source_file_id?: string | null
          source_page?: number | null
          source_sheet?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          teacher_notes?: string | null
          updated_at?: string
        }
        Update: {
          answer_key?: Json
          content_hash?: string | null
          context_kind?: Database["public"]["Enums"]["context_kind"]
          context_sort?: number
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          difficulty?: number | null
          explanation?: string | null
          grading_mode?: string
          id?: string
          import_job_id?: string | null
          instructions?: string | null
          learning_language?: string | null
          level?: string | null
          listening_question_set_id?: string | null
          media_id?: string | null
          normalization?: Json
          payload?: Json
          prompt?: string
          provenance?: Json
          question_type?: string
          reading_question_set_id?: string | null
          reusable_independently?: boolean
          scoring?: Json
          search?: unknown
          source_file_id?: string | null
          source_page?: number | null
          source_sheet?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          teacher_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_learning_language_fkey"
            columns: ["learning_language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "questions_listening_question_set_id_fkey"
            columns: ["listening_question_set_id"]
            isOneToOne: false
            referencedRelation: "listening_question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_reading_question_set_id_fkey"
            columns: ["reading_question_set_id"]
            isOneToOne: false
            referencedRelation: "reading_question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_media: {
        Row: {
          media_id: string
          reading_id: string
          sort_order: number
        }
        Insert: {
          media_id: string
          reading_id: string
          sort_order?: number
        }
        Update: {
          media_id?: string
          reading_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "reading_media_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_media_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_question_sets: {
        Row: {
          id: string
          instructions: string | null
          reading_id: string
          sort_order: number
          title: string | null
        }
        Insert: {
          id?: string
          instructions?: string | null
          reading_id: string
          sort_order?: number
          title?: string | null
        }
        Update: {
          id?: string
          instructions?: string | null
          reading_id?: string
          sort_order?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reading_question_sets_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
        ]
      }
      readings: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          display_layout: string
          id: string
          learning_language: string | null
          level: string | null
          metadata: Json
          source_file_id: string | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
          word_count: number | null
        }
        Insert: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          display_layout?: string
          id?: string
          learning_language?: string | null
          level?: string | null
          metadata?: Json
          source_file_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
          word_count?: number | null
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          display_layout?: string
          id?: string
          learning_language?: string | null
          level?: string | null
          metadata?: Json
          source_file_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "readings_learning_language_fkey"
            columns: ["learning_language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "readings_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      source_collection_items: {
        Row: {
          entity_id: string
          entity_type: string
          source_file_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          source_file_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          source_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_collection_items_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      source_upload_sessions: {
        Row: {
          id: string
          storage_path: string
          original_filename: string
          mime_type: string | null
          expected_size_bytes: number
          keep_original: boolean
          created_at: string
          expires_at: string
          finalized_at: string | null
          source_file_id: string | null
        }
        Insert: {
          id?: string
          storage_path: string
          original_filename: string
          mime_type?: string | null
          expected_size_bytes: number
          keep_original?: boolean
          created_at?: string
          expires_at: string
          finalized_at?: string | null
          source_file_id?: string | null
        }
        Update: {
          id?: string
          storage_path?: string
          original_filename?: string
          mime_type?: string | null
          expected_size_bytes?: number
          keep_original?: boolean
          created_at?: string
          expires_at?: string
          finalized_at?: string | null
          source_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_upload_sessions_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      source_files: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          keep_original: boolean
          metadata: Json
          mime_type: string | null
          original_deleted_at: string | null
          original_filename: string
          page_count: number | null
          size_bytes: number | null
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          keep_original?: boolean
          metadata?: Json
          mime_type?: string | null
          original_deleted_at?: string | null
          original_filename: string
          page_count?: number | null
          size_bytes?: number | null
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          keep_original?: boolean
          metadata?: Json
          mime_type?: string | null
          original_deleted_at?: string | null
          original_filename?: string
          page_count?: number | null
          size_bytes?: number | null
          storage_path?: string | null
        }
        Relationships: []
      }
      student_vocabulary_state: {
        Row: {
          student_id: string
          entry_id: string
          state: string
          correct_count: number
          incorrect_count: number
          correct_streak: number
          last_result: boolean | null
          last_mode: string | null
          last_practiced_at: string | null
          updated_at: string
        }
        Insert: {
          student_id: string
          entry_id: string
          state?: string
          correct_count?: number
          incorrect_count?: number
          correct_streak?: number
          last_result?: boolean | null
          last_mode?: string | null
          last_practiced_at?: string | null
          updated_at?: string
        }
        Update: {
          student_id?: string
          entry_id?: string
          state?: string
          correct_count?: number
          incorrect_count?: number
          correct_streak?: number
          last_result?: boolean | null
          last_mode?: string | null
          last_practiced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_vocabulary_state_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_vocabulary_state_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      student_access_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_hint: string | null
          revoked_at: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_hint?: string | null
          revoked_at?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_hint?: string | null
          revoked_at?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_access_keys_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_sessions: {
        Row: {
          auth_session_id: string
          current_location: string | null
          id: string
          ip: string | null
          last_seen_at: string
          revoked_at: string | null
          started_at: string
          student_id: string
          user_agent: string | null
        }
        Insert: {
          auth_session_id: string
          current_location?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          started_at?: string
          student_id: string
          user_agent?: string | null
        }
        Update: {
          auth_session_id?: string
          current_location?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          started_at?: string
          student_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          auth_user_id: string | null
          created_at: string
          deleted_at: string | null
          first_name: string
          id: string
          interface_language: string | null
          last_active_at: string | null
          last_name: string
          status: Database["public"]["Enums"]["student_status"]
          updated_at: string
          username: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          first_name: string
          id?: string
          interface_language?: string | null
          last_active_at?: string | null
          last_name: string
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
          username: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          first_name?: string
          id?: string
          interface_language?: string | null
          last_active_at?: string | null
          last_name?: string
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_interface_language_fkey"
            columns: ["interface_language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
        ]
      }
      system_settings: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      teacher_feedback: {
        Row: {
          answer_id: string | null
          attempt_id: string | null
          body: string
          created_at: string
          id: string
          student_id: string
        }
        Insert: {
          answer_id?: string | null
          attempt_id?: string | null
          body: string
          created_at?: string
          id?: string
          student_id: string
        }
        Update: {
          answer_id?: string | null
          attempt_id?: string | null
          body?: string
          created_at?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_feedback_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "attempt_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_feedback_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_feedback_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          created_at: string
          id: string
          learning_language: string | null
          name: string
          parent_id: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          learning_language?: string | null
          name: string
          parent_id?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          learning_language?: string | null
          name?: string
          parent_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "topics_learning_language_fkey"
            columns: ["learning_language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "topics_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vocabulary_entries: {
        Row: {
          antonyms: string[]
          audio_media_id: string | null
          created_at: string
          definition: string | null
          deleted_at: string | null
          id: string
          ipa: string | null
          learning_language: string | null
          level: string | null
          notes: string | null
          part_of_speech: string | null
          provenance: Json
          source_file_id: string | null
          status: Database["public"]["Enums"]["content_status"]
          synonyms: string[]
          updated_at: string
          word: string
        }
        Insert: {
          antonyms?: string[]
          audio_media_id?: string | null
          created_at?: string
          definition?: string | null
          deleted_at?: string | null
          id?: string
          ipa?: string | null
          learning_language?: string | null
          level?: string | null
          notes?: string | null
          part_of_speech?: string | null
          provenance?: Json
          source_file_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          synonyms?: string[]
          updated_at?: string
          word: string
        }
        Update: {
          antonyms?: string[]
          audio_media_id?: string | null
          created_at?: string
          definition?: string | null
          deleted_at?: string | null
          id?: string
          ipa?: string | null
          learning_language?: string | null
          level?: string | null
          notes?: string | null
          part_of_speech?: string | null
          provenance?: Json
          source_file_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          synonyms?: string[]
          updated_at?: string
          word?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_entries_audio_media_id_fkey"
            columns: ["audio_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_entries_learning_language_fkey"
            columns: ["learning_language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "vocabulary_entries_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_examples: {
        Row: {
          entry_id: string
          id: string
          sentence: string
          sort_order: number
          translation: string | null
        }
        Insert: {
          entry_id: string
          id?: string
          sentence: string
          sort_order?: number
          translation?: string | null
        }
        Update: {
          entry_id?: string
          id?: string
          sentence?: string
          sort_order?: number
          translation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_examples_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_learner_states: {
        Row: {
          entry_id: string
          state: string
          student_id: string
          updated_at: string
        }
        Insert: {
          entry_id: string
          state: string
          student_id: string
          updated_at?: string
        }
        Update: {
          entry_id?: string
          state?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_learner_states_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_learner_states_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_tags: {
        Row: {
          entry_id: string
          tag_id: string
        }
        Insert: {
          entry_id: string
          tag_id: string
        }
        Update: {
          entry_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_tags_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_topics: {
        Row: {
          entry_id: string
          topic_id: string
        }
        Insert: {
          entry_id: string
          topic_id: string
        }
        Update: {
          entry_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_topics_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      vocabulary_translations: {
        Row: {
          entry_id: string
          id: string
          language: string
          value: string
        }
        Insert: {
          entry_id: string
          id?: string
          language: string
          value: string
        }
        Update: {
          entry_id?: string
          id?: string
          language?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_translations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_translations_language_fkey"
            columns: ["language"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_student_id: { Args: never; Returns: string }
      claim_scheduled_backup: {
        Args: { p_interval_hours: number }
        Returns: string | null
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_teacher: { Args: never; Returns: boolean }
      reorder_catalog_items: {
        Args: { p_catalog_id: string; p_item_ids: string[] }
        Returns: undefined
      }
      select_self_practice_question_ids: {
        Args: {
          p_student_id: string
          p_count: number
          p_language?: string | null
          p_level?: string | null
          p_types?: string[] | null
          p_topic_ids?: string[] | null
          p_catalog_id?: string | null
          p_source_file_id?: string | null
          p_history_mode?: string
          p_exclude_answered?: boolean
        }
        Returns: { question_id: string }[]
      }
      save_language_settings: {
        Args: { p_languages: Json }
        Returns: undefined
      }
      storage_usage_summary: {
        Args: never
        Returns: {
          category: string
          bytes: number
          items: number
        }[]
      }
      teacher_question_analytics: {
        Args: { p_limit?: number }
        Returns: {
          question_id: string
          prompt: string
          question_type: string
          attempts: number
          correct: number
          incorrect: number
          manual: number
          skips: number
          accuracy: number | null
          skip_rate: number | null
          avg_time_ms: number | null
          difficulty_suggestion: string | null
        }[]
      }
      teacher_catalog_analytics: {
        Args: { p_limit?: number }
        Returns: {
          catalog_id: string
          catalog_name: string
          content_items: number
          question_items: number
          vocabulary_items: number
          reading_items: number
          listening_items: number
          students_practiced: number
          sessions: number
          answer_attempts: number
          avg_accuracy: number | null
          avg_time_ms: number | null
          last_activity: string | null
          weak_topics: Json
        }[]
      }
      teacher_student_analytics: {
        Args: { p_limit?: number }
        Returns: {
          student_id: string
          student_name: string
          username: string
          status: Database["public"]["Enums"]["student_status"]
          last_active_at: string | null
          practice_answers: number
          practice_accuracy: number | null
          study_time_ms: number
          exam_attempts: number
          exam_accuracy_percent: number | null
          last_activity: string | null
        }[]
      }
      student_practice_stats: {
        Args: { p_student_id: string }
        Returns: {
          total_answers: number
          correct_answers: number
          wrong_answers: number
          manual_answers: number
          questions_seen: number
          total_time_ms: number
          today_answers: number
          week_answers: number
          current_mistakes: number
        }[]
      }
      student_streak_stats: {
        Args: { p_student_id: string }
        Returns: {
          current_streak: number
          longest_streak: number
          last_active_day: string | null
        }[]
      }
      student_domain_progress: {
        Args: { p_student_id: string }
        Returns: {
          domain: string
          attempts: number
          correct: number
          incorrect: number
          accuracy: number | null
        }[]
      }
      student_topic_practice_stats: {
        Args: { p_student_id: string; p_limit?: number }
        Returns: {
          topic_id: string
          topic_name: string
          attempts: number
          correct: number
          accuracy: number | null
        }[]
      }
      student_practice_daily_stats: {
        Args: { p_student_id: string; p_days?: number }
        Returns: {
          day: string
          attempts: number
          correct: number
        }[]
      }
      reorder_exam_sections: {
        Args: { p_exam_id: string; p_section_ids: string[] }
        Returns: undefined
      }
      reorder_exam_items: {
        Args: { p_exam_id: string; p_section_id: string | null; p_item_ids: string[] }
        Returns: undefined
      }
      save_attempt_answer: {
        Args: {
          p_attempt_id: string
          p_item_key: string
          p_question_id: string | null
          p_question_version: number | null
          p_response: Json | null
          p_flagged: boolean
          p_time_spent_ms: number
        }
        Returns: Database["public"]["Tables"]["attempt_answers"]["Row"]
      }
      claim_exam_listening_play: {
        Args: {
          p_attempt_id: string
          p_lease_seconds: number
          p_listening_id: string
          p_max_plays: number | null
          p_request_id: string
          p_stream_token_hash: string
          p_student_id: string
        }
        Returns: {
          expires_at: string
          id: string
          play_number: number
        }[]
      }
      append_exam_violation: {
        Args: { p_attempt_id: string; p_event: Json }
        Returns: Json
      }
    }
    Enums: {
      app_role: "teacher" | "student"
      attempt_status:
        | "in_progress"
        | "submitted"
        | "auto_submitted"
        | "graded"
        | "abandoned"
      content_status: "draft" | "active" | "archived"
      context_kind: "none" | "reading" | "listening"
      exam_status: "draft" | "scheduled" | "active" | "finished" | "archived"
      job_status:
        | "queued"
        | "processing"
        | "needs_review"
        | "completed"
        | "failed"
      media_kind: "image" | "audio" | "video" | "document" | "other"
      review_status: "pending" | "reviewed"
      student_status: "active" | "disabled" | "archived"
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
    Enums: {
      app_role: ["teacher", "student"],
      attempt_status: [
        "in_progress",
        "submitted",
        "auto_submitted",
        "graded",
        "abandoned",
      ],
      content_status: ["draft", "active", "archived"],
      context_kind: ["none", "reading", "listening"],
      exam_status: ["draft", "scheduled", "active", "finished", "archived"],
      job_status: [
        "queued",
        "processing",
        "needs_review",
        "completed",
        "failed",
      ],
      media_kind: ["image", "audio", "video", "document", "other"],
      review_status: ["pending", "reviewed"],
      student_status: ["active", "disabled", "archived"],
    },
  },
} as const
