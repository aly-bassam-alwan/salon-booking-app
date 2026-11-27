
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "appointment_services": {
                  Row: {
                    "appointment_id": string,"duration_minutes": number,"position": number,"price_minor": number,"service_id": string,"service_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"duration_minutes": number,"position": number,"price_minor": number,"service_id": string,"service_name": string
                  }
                  Update: {
                    "appointment_id"?: string,"duration_minutes"?: number,"position"?: number,"price_minor"?: number,"service_id"?: string,"service_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_services_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_services_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "barber_id": string,"cancelled_at": string | null,"cancelled_by": string | null,"created_at": string,"currency": string,"customer_id": string,"customer_note": string | null,"ends_at": string,"id": string,"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"total_duration_minutes": number,"total_price_minor": number
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id": string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"currency": string,"customer_id": string,"customer_note"?: string | null,"ends_at": string,"id"?: string,"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"total_duration_minutes": number,"total_price_minor": number
                  }
                  Update: {
                    "barber_id"?: string,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"currency"?: string,"customer_id"?: string,"customer_note"?: string | null,"ends_at"?: string,"id"?: string,"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"total_duration_minutes"?: number,"total_price_minor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"barbers": {
                  Row: {
                    "bio": string | null,"created_at": string,"display_name": string,"id": string,"is_active": boolean,"photo_url": string | null,"profile_id": string | null,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "bio"?: string | null,"created_at"?: string,"display_name": string,"id"?: string,"is_active"?: boolean,"photo_url"?: string | null,"profile_id"?: string | null,"sort_order"?: number
                  }
                  Update: {
                    "bio"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"is_active"?: boolean,"photo_url"?: string | null,"profile_id"?: string | null,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "barbers_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"phone": string | null,"role": Database["public"]['Enums']["user_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string,"id": string,"phone"?: string | null,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"phone"?: string | null,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Relationships: [
                    
                  ]
                },"salon_settings": {
                  Row: {
                    "booking_window_days": number,"cancellation_cutoff_minutes": number,"currency": string,"id": boolean,"min_lead_minutes": number,"name": string,"phone": string | null,"slot_interval_minutes": number,"timezone": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_window_days": number,"cancellation_cutoff_minutes": number,"currency": string,"id"?: boolean,"min_lead_minutes": number,"name": string,"phone"?: string | null,"slot_interval_minutes"?: number,"timezone": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "booking_window_days"?: number,"cancellation_cutoff_minutes"?: number,"currency"?: string,"id"?: boolean,"min_lead_minutes"?: number,"name"?: string,"phone"?: string | null,"slot_interval_minutes"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "salon_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"services": {
                  Row: {
                    "created_at": string,"description": string | null,"duration_minutes": number,"id": string,"is_active": boolean,"name": string,"price_minor": number,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"duration_minutes": number,"id"?: string,"is_active"?: boolean,"name": string,"price_minor": number,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"duration_minutes"?: number,"id"?: string,"is_active"?: boolean,"name"?: string,"price_minor"?: number,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"time_off": {
                  Row: {
                    "barber_id": string | null,"created_at": string,"created_by": string | null,"ends_at": string,"id": string,"reason": string | null,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_at": string,"id"?: string,"reason"?: string | null,"starts_at": string
                  }
                  Update: {
                    "barber_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string,"id"?: string,"reason"?: string | null,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_off_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"working_hours": {
                  Row: {
                    "barber_id": string,"end_time": string,"id": string,"start_time": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "barber_id": string,"end_time": string,"id"?: string,"start_time": string,"weekday": number
                  }
                  Update: {
                    "barber_id"?: string,"end_time"?: string,"id"?: string,"start_time"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "working_hours_barber_id_fkey"
      columns: ["barber_id"]
isOneToOne: false
      referencedRelation: "barbers"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "book_appointment":
{ Args: { "p_barber_id": string,"p_note"?: string,"p_service_ids": (string)[],"p_start_time": string }; Returns: {
              "barber_id": string,
"cancelled_at": string | null,
"cancelled_by": string | null,
"created_at": string,
"currency": string,
"customer_id": string,
"customer_note": string | null,
"ends_at": string,
"id": string,
"starts_at": string,
"status": Database["public"]['Enums']["appointment_status"],
"total_duration_minutes": number,
"total_price_minor": number
            }
                          SetofOptions: {
        from: "*"
        to: "appointments"
        isOneToOne: true
        isSetofReturn: false
      } },
"cancel_appointment":
{ Args: { "p_appointment_id": string }; Returns: {
              "barber_id": string,
"cancelled_at": string | null,
"cancelled_by": string | null,
"created_at": string,
"currency": string,
"customer_id": string,
"customer_note": string | null,
"ends_at": string,
"id": string,
"starts_at": string,
"status": Database["public"]['Enums']["appointment_status"],
"total_duration_minutes": number,
"total_price_minor": number
            }
                          SetofOptions: {
        from: "*"
        to: "appointments"
        isOneToOne: true
        isSetofReturn: false
      } },
"current_barber_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_busy_times":
{ Args: { "p_from"?: string,"p_to"?: string }; Returns: {
              "barber_id": string,"ends_at": string,"starts_at": string
            }[]
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
          }
          Enums: {
            "appointment_status": "booked"|"cancelled"|"completed"|"no_show","user_role": "customer"|"barber"|"admin"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "appointment_status": ["booked", "cancelled", "completed", "no_show"],"user_role": ["customer", "barber", "admin"]
          }
        }
} as const
