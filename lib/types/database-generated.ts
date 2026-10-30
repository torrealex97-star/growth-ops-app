// GENERADO — no editar a mano. Fuente: OpenAPI de PostgREST (2026-10-30T11:07:24.942Z).
// Regenerar con: npm run tipos:bd  (y commitear). El test tests/esquema-tenant-invariante.test.mjs
// comprueba que este artefacto sigue fresco respecto al esquema vivo.
// Espejo exacto del esquema public de Supabase; los tipos de APP siguen en lib/types/database.ts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type EsquemaPublico = {
  Tables: {
    Activities: {
      Row: {
        id: string
        contact_id: string
        person_id: string | null
        type: string
        activity_datetime: string
        direction: string
        result: string | null
        duration_min: number | string | null
        notes: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        contact_id: string
        person_id: string | null | undefined
        type: string | undefined
        activity_datetime: string | undefined
        direction: string | undefined
        result: string | null | undefined
        duration_min: number | string | null | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        person_id: string | undefined
        type: string | undefined
        activity_datetime: string | undefined
        direction: string | undefined
        result: string | undefined
        duration_min: number | string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateCampaignMembers: {
      Row: {
        id: string
        campaign_id: string
        affiliate_id: string
        created_by: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        campaign_id: string
        affiliate_id: string
        created_by: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        campaign_id: string | undefined
        affiliate_id: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateCampaigns: {
      Row: {
        id: string
        name: string
        type: string
        base_url: string
        is_active: boolean
        created_by: string | null
        created_at: string
        updated_at: string
        registration_slug: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        type: string | undefined
        base_url: string
        is_active: boolean | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        registration_slug: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        type: string | undefined
        base_url: string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        registration_slug: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateProfiles: {
      Row: {
        user_id: string
        instagram: string | null
        audience_size: string | null
        niche: string | null
        source: string | null
        motivation: string | null
        extra: Json | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        user_id: string
        instagram: string | null | undefined
        audience_size: string | null | undefined
        niche: string | null | undefined
        source: string | null | undefined
        motivation: string | null | undefined
        extra: Json | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        user_id: string | undefined
        instagram: string | undefined
        audience_size: string | undefined
        niche: string | undefined
        source: string | undefined
        motivation: string | undefined
        extra: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AffiliateProgramSettings: {
      Row: {
        id: number
        default_commission_percent: number | string
        program_name: string
        intro: string
        success_message: string
        form_fields: Json
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: number | undefined
        default_commission_percent: number | string | undefined
        program_name: string | undefined
        intro: string | undefined
        success_message: string | undefined
        form_fields: Json
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: number | undefined
        default_commission_percent: number | string | undefined
        program_name: string | undefined
        intro: string | undefined
        success_message: string | undefined
        form_fields: Json | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AiBusinessFacts: {
      Row: {
        id: string
        tenant_id: string
        type: string
        content: string
        evidence: Json | null
        outcome_of: string | null
        created_by: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        type: string
        content: string
        evidence: Json | null | undefined
        outcome_of: string | null | undefined
        created_by: string
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        type: string | undefined
        content: string | undefined
        evidence: Json | undefined
        outcome_of: string | undefined
        created_by: string | undefined
        created_at: string | undefined
      }
    }
    AiConversations: {
      Row: {
        id: string
        tenant_id: string
        user_id: string
        title: string | null
        screen: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        user_id: string
        title: string | null | undefined
        screen: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        title: string | undefined
        screen: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    AiInsights: {
      Row: {
        id: string
        tenant_id: string
        type: string
        severity: string
        title: string
        summary: string
        evidence: Json
        status: string
        fingerprint: string
        period_start: string | null
        period_end: string | null
        generated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        type: string
        severity: string
        title: string
        summary: string
        evidence: Json
        status: string | undefined
        fingerprint: string
        period_start: string | null | undefined
        period_end: string | null | undefined
        generated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        type: string | undefined
        severity: string | undefined
        title: string | undefined
        summary: string | undefined
        evidence: Json | undefined
        status: string | undefined
        fingerprint: string | undefined
        period_start: string | undefined
        period_end: string | undefined
        generated_at: string | undefined
      }
    }
    AiMessages: {
      Row: {
        id: string
        tenant_id: string
        conversation_id: string
        role: string
        content: string
        evidence: Json | null
        created_at: string
        model: string | null
        input_tokens: number | null
        output_tokens: number | null
        cache_read_tokens: number | null
        cache_write_tokens: number | null
        cost_usd: number | string | null
        latency_ms: number | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        conversation_id: string
        role: string
        content: string
        evidence: Json | null | undefined
        created_at: string | undefined
        model: string | null | undefined
        input_tokens: number | null | undefined
        output_tokens: number | null | undefined
        cache_read_tokens: number | null | undefined
        cache_write_tokens: number | null | undefined
        cost_usd: number | string | null | undefined
        latency_ms: number | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        role: string | undefined
        content: string | undefined
        evidence: Json | undefined
        created_at: string | undefined
        model: string | undefined
        input_tokens: number | undefined
        output_tokens: number | undefined
        cache_read_tokens: number | undefined
        cache_write_tokens: number | undefined
        cost_usd: number | string | undefined
        latency_ms: number | undefined
      }
    }
    AiToolCalls: {
      Row: {
        id: string
        tenant_id: string
        conversation_id: string
        message_id: string | null
        tool_name: string
        input: Json
        result_summary: string | null
        success: boolean
        latency_ms: number | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        conversation_id: string
        message_id: string | null | undefined
        tool_name: string
        input: Json
        result_summary: string | null | undefined
        success: boolean | undefined
        latency_ms: number | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        message_id: string | undefined
        tool_name: string | undefined
        input: Json | undefined
        result_summary: string | undefined
        success: boolean | undefined
        latency_ms: number | undefined
        created_at: string | undefined
      }
    }
    AnalyticsSessions: {
      Row: {
        id: string
        visitor_id: string | null
        external_session_id: string | null
        started_at: string
        ended_at: string | null
        landing_url: string | null
        referrer: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        utm_term: string | null
        gclid: string | null
        fbclid: string | null
        ttclid: string | null
        raw_parameters: Json
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        visitor_id: string | null | undefined
        external_session_id: string | null | undefined
        started_at: string
        ended_at: string | null | undefined
        landing_url: string | null | undefined
        referrer: string | null | undefined
        utm_source: string | null | undefined
        utm_medium: string | null | undefined
        utm_campaign: string | null | undefined
        utm_content: string | null | undefined
        utm_term: string | null | undefined
        gclid: string | null | undefined
        fbclid: string | null | undefined
        ttclid: string | null | undefined
        raw_parameters: Json
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        visitor_id: string | undefined
        external_session_id: string | undefined
        started_at: string | undefined
        ended_at: string | undefined
        landing_url: string | undefined
        referrer: string | undefined
        utm_source: string | undefined
        utm_medium: string | undefined
        utm_campaign: string | undefined
        utm_content: string | undefined
        utm_term: string | undefined
        gclid: string | undefined
        fbclid: string | undefined
        ttclid: string | undefined
        raw_parameters: Json | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AnalyticsTouchpoints: {
      Row: {
        id: string
        visitor_id: string | null
        session_id: string | null
        contact_id: string | null
        occurred_at: string
        channel: string
        source: string | null
        medium: string | null
        campaign: string | null
        ad_set: string | null
        ad: string | null
        creative: string | null
        landing_url: string | null
        referrer: string | null
        click_id_type: string | null
        click_id: string | null
        capture_method: string
        observation_type: string
        consent_snapshot: Json
        raw_payload: Json
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        visitor_id: string | null | undefined
        session_id: string | null | undefined
        contact_id: string | null | undefined
        occurred_at: string
        channel: string | undefined
        source: string | null | undefined
        medium: string | null | undefined
        campaign: string | null | undefined
        ad_set: string | null | undefined
        ad: string | null | undefined
        creative: string | null | undefined
        landing_url: string | null | undefined
        referrer: string | null | undefined
        click_id_type: string | null | undefined
        click_id: string | null | undefined
        capture_method: string | undefined
        observation_type: string | undefined
        consent_snapshot: Json
        raw_payload: Json
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        visitor_id: string | undefined
        session_id: string | undefined
        contact_id: string | undefined
        occurred_at: string | undefined
        channel: string | undefined
        source: string | undefined
        medium: string | undefined
        campaign: string | undefined
        ad_set: string | undefined
        ad: string | undefined
        creative: string | undefined
        landing_url: string | undefined
        referrer: string | undefined
        click_id_type: string | undefined
        click_id: string | undefined
        capture_method: string | undefined
        observation_type: string | undefined
        consent_snapshot: Json | undefined
        raw_payload: Json | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    AnalyticsVisitors: {
      Row: {
        id: string
        anonymous_id: string | null
        contact_id: string | null
        first_seen_at: string
        last_seen_at: string
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        anonymous_id: string | null | undefined
        contact_id: string | null | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        anonymous_id: string | undefined
        contact_id: string | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Annotations: {
      Row: {
        id: string
        tenant_id: string
        date: string
        title: string
        description: string | null
        category: string | null
        created_by: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        date: string
        title: string
        description: string | null | undefined
        category: string | null | undefined
        created_by: string
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        date: string | undefined
        title: string | undefined
        description: string | undefined
        category: string | undefined
        created_by: string | undefined
        created_at: string | undefined
      }
    }
    AppSettings: {
      Row: {
        key: string
        value: Json
        updated_at: string
        tenant_id: string
      }
      Insert: {
        key: string
        value: Json
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        key: string | undefined
        value: Json | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Appointments: {
      Row: {
        id: string
        external_source: string
        external_id: string | null
        contact_id: string
        appointment_datetime: string
        status: string
        setter_id: string | null
        closer_id: string | null
        source: string | null
        pipeline_name: string | null
        pipeline_stage: string | null
        calendar_name: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        utm_term: string | null
        raw_payload: Json | null
        notes: string | null
        created_at: string
        updated_at: string
        recording_url: string | null
        result: string | null
        appointment_type: string | null
        origin_appointment_id: string | null
        event_type: string | null
        grade: number | null
        triager_id: string | null
        cold_caller_id: string | null
        affiliate_id: string | null
        pipe_value: number | string | null
        offered: boolean | null
        payment_deal: string | null
        qualification: Json | null
        transcript: string | null
        transcript_drive_url: string | null
        transcript_status: string | null
        ai_call_score: number | null
        ai_lead_score: number | null
        ai_suggested_stage: string | null
        ai_summary: string | null
        ai_analysis: Json | null
        ai_analyzed_at: string | null
        duration_minutes: number | null
        meeting_url: string | null
        reschedule_url: string | null
        calendly_event_uuid: string | null
        needs_followup: boolean
        calendly_cleanup_pending: boolean | null
        calendly_cleanup_event_uuid: string | null
        followup_stage: string | null
        last_contacted_at: string | null
        rescheduled_from_status: string | null
        library_shared: boolean
        tenant_id: string
        fathom_meeting_id: string | null
        offered_by: string | null
        offered_at: string | null
        ghl_calendar_id: string | null
        attribution_first: Json | null
        attribution_second: Json | null
        attribution_last: Json | null
        attribution_booking: Json | null
        attribution_status: string
      }
      Insert: {
        id: string | undefined
        external_source: string | undefined
        external_id: string | null | undefined
        contact_id: string
        appointment_datetime: string
        status: string | undefined
        setter_id: string | null | undefined
        closer_id: string | null | undefined
        source: string | null | undefined
        pipeline_name: string | null | undefined
        pipeline_stage: string | null | undefined
        calendar_name: string | null | undefined
        utm_source: string | null | undefined
        utm_medium: string | null | undefined
        utm_campaign: string | null | undefined
        utm_content: string | null | undefined
        utm_term: string | null | undefined
        raw_payload: Json | null | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        recording_url: string | null | undefined
        result: string | null | undefined
        appointment_type: string | null | undefined
        origin_appointment_id: string | null | undefined
        event_type: string | null | undefined
        grade: number | null | undefined
        triager_id: string | null | undefined
        cold_caller_id: string | null | undefined
        affiliate_id: string | null | undefined
        pipe_value: number | string | null | undefined
        offered: boolean | null | undefined
        payment_deal: string | null | undefined
        qualification: Json | null | undefined
        transcript: string | null | undefined
        transcript_drive_url: string | null | undefined
        transcript_status: string | null | undefined
        ai_call_score: number | null | undefined
        ai_lead_score: number | null | undefined
        ai_suggested_stage: string | null | undefined
        ai_summary: string | null | undefined
        ai_analysis: Json | null | undefined
        ai_analyzed_at: string | null | undefined
        duration_minutes: number | null | undefined
        meeting_url: string | null | undefined
        reschedule_url: string | null | undefined
        calendly_event_uuid: string | null | undefined
        needs_followup: boolean | undefined
        calendly_cleanup_pending: boolean | null | undefined
        calendly_cleanup_event_uuid: string | null | undefined
        followup_stage: string | null | undefined
        last_contacted_at: string | null | undefined
        rescheduled_from_status: string | null | undefined
        library_shared: boolean | undefined
        tenant_id: string
        fathom_meeting_id: string | null | undefined
        offered_by: string | null | undefined
        offered_at: string | null | undefined
        ghl_calendar_id: string | null | undefined
        attribution_first: Json | null | undefined
        attribution_second: Json | null | undefined
        attribution_last: Json | null | undefined
        attribution_booking: Json | null | undefined
        attribution_status: string | undefined
      }
      Update: {
        id: string | undefined
        external_source: string | undefined
        external_id: string | undefined
        contact_id: string | undefined
        appointment_datetime: string | undefined
        status: string | undefined
        setter_id: string | undefined
        closer_id: string | undefined
        source: string | undefined
        pipeline_name: string | undefined
        pipeline_stage: string | undefined
        calendar_name: string | undefined
        utm_source: string | undefined
        utm_medium: string | undefined
        utm_campaign: string | undefined
        utm_content: string | undefined
        utm_term: string | undefined
        raw_payload: Json | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        recording_url: string | undefined
        result: string | undefined
        appointment_type: string | undefined
        origin_appointment_id: string | undefined
        event_type: string | undefined
        grade: number | undefined
        triager_id: string | undefined
        cold_caller_id: string | undefined
        affiliate_id: string | undefined
        pipe_value: number | string | undefined
        offered: boolean | undefined
        payment_deal: string | undefined
        qualification: Json | undefined
        transcript: string | undefined
        transcript_drive_url: string | undefined
        transcript_status: string | undefined
        ai_call_score: number | undefined
        ai_lead_score: number | undefined
        ai_suggested_stage: string | undefined
        ai_summary: string | undefined
        ai_analysis: Json | undefined
        ai_analyzed_at: string | undefined
        duration_minutes: number | undefined
        meeting_url: string | undefined
        reschedule_url: string | undefined
        calendly_event_uuid: string | undefined
        needs_followup: boolean | undefined
        calendly_cleanup_pending: boolean | undefined
        calendly_cleanup_event_uuid: string | undefined
        followup_stage: string | undefined
        last_contacted_at: string | undefined
        rescheduled_from_status: string | undefined
        library_shared: boolean | undefined
        tenant_id: string | undefined
        fathom_meeting_id: string | undefined
        offered_by: string | undefined
        offered_at: string | undefined
        ghl_calendar_id: string | undefined
        attribution_first: Json | undefined
        attribution_second: Json | undefined
        attribution_last: Json | undefined
        attribution_booking: Json | undefined
        attribution_status: string | undefined
      }
    }
    AuditLogs: {
      Row: {
        id: string
        actor_user_id: string | null
        entity_type: string
        entity_id: string
        action: string
        old_values: Json | null
        new_values: Json | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        actor_user_id: string | null | undefined
        entity_type: string
        entity_id: string
        action: string
        old_values: Json | null | undefined
        new_values: Json | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        actor_user_id: string | undefined
        entity_type: string | undefined
        entity_id: string | undefined
        action: string | undefined
        old_values: Json | undefined
        new_values: Json | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CallRecordings: {
      Row: {
        id: string
        tenant_id: string
        storage_path: string
        file_name: string
        mime_type: string
        size_bytes: number | string
        sha256: string
        category: string
        status: string
        appointment_id: string | null
        notes: string | null
        uploaded_by: string | null
        reviewed_by: string | null
        reviewed_at: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        storage_path: string
        file_name: string
        mime_type: string
        size_bytes: number | string
        sha256: string
        category: string
        status: string | undefined
        appointment_id: string | null | undefined
        notes: string | null | undefined
        uploaded_by: string | null | undefined
        reviewed_by: string | null | undefined
        reviewed_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        storage_path: string | undefined
        file_name: string | undefined
        mime_type: string | undefined
        size_bytes: number | string | undefined
        sha256: string | undefined
        category: string | undefined
        status: string | undefined
        appointment_id: string | undefined
        notes: string | undefined
        uploaded_by: string | undefined
        reviewed_by: string | undefined
        reviewed_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    CampaignAds: {
      Row: {
        id: string
        external_id: string
        campaign_external_id: string | null
        campaign_id: string | null
        account_id: string | null
        account_name: string | null
        name: string
        adset_name: string | null
        status: string | null
        spend: number | string | null
        impressions: number | string | null
        clicks: number | string | null
        reach: number | string | null
        link_clicks: number | string | null
        landing_views: number | string | null
        leads: number | null
        followers: number | null
        synced_at: string | null
        created_at: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        external_id: string
        campaign_external_id: string | null | undefined
        campaign_id: string | null | undefined
        account_id: string | null | undefined
        account_name: string | null | undefined
        name: string
        adset_name: string | null | undefined
        status: string | null | undefined
        spend: number | string | null | undefined
        impressions: number | string | null | undefined
        clicks: number | string | null | undefined
        reach: number | string | null | undefined
        link_clicks: number | string | null | undefined
        landing_views: number | string | null | undefined
        leads: number | null | undefined
        followers: number | null | undefined
        synced_at: string | null | undefined
        created_at: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        campaign_external_id: string | undefined
        campaign_id: string | undefined
        account_id: string | undefined
        account_name: string | undefined
        name: string | undefined
        adset_name: string | undefined
        status: string | undefined
        spend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        reach: number | string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        leads: number | undefined
        followers: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CampaignDaily: {
      Row: {
        id: string
        campaign_id: string
        external_id: string | null
        account_id: string | null
        date: string
        spend: number | string
        impressions: number | string
        clicks: number | string
        leads: number
        reach: number | string
        updated_at: string
        link_clicks: number | string
        landing_views: number | string
        tenant_id: string
        meta_actions: Json | null
        meta_action_values: Json | null
      }
      Insert: {
        id: string | undefined
        campaign_id: string
        external_id: string | null | undefined
        account_id: string | null | undefined
        date: string
        spend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        leads: number | undefined
        reach: number | string | undefined
        updated_at: string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        tenant_id: string
        meta_actions: Json | null | undefined
        meta_action_values: Json | null | undefined
      }
      Update: {
        id: string | undefined
        campaign_id: string | undefined
        external_id: string | undefined
        account_id: string | undefined
        date: string | undefined
        spend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        leads: number | undefined
        reach: number | string | undefined
        updated_at: string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        tenant_id: string | undefined
        meta_actions: Json | undefined
        meta_action_values: Json | undefined
      }
    }
    CampaignFunnelAssignments: {
      Row: {
        id: string
        tenant_id: string
        campaign_id: string
        funnel_type: string
        custom_funnel_id: string | null
        assigned_by: string | null
        assigned_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        campaign_id: string
        funnel_type: string
        custom_funnel_id: string | null | undefined
        assigned_by: string | null | undefined
        assigned_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        campaign_id: string | undefined
        funnel_type: string | undefined
        custom_funnel_id: string | undefined
        assigned_by: string | undefined
        assigned_at: string | undefined
      }
    }
    CampaignTargets: {
      Row: {
        id: string
        tenant_id: string
        target_roas: number | string | null
        target_cac: number | string | null
        target_cpl: number | string | null
        updated_by: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        target_roas: number | string | null | undefined
        target_cac: number | string | null | undefined
        target_cpl: number | string | null | undefined
        updated_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        target_roas: number | string | undefined
        target_cac: number | string | undefined
        target_cpl: number | string | undefined
        updated_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Campaigns: {
      Row: {
        id: string
        name: string
        channel: string
        type: string | null
        start_date: string | null
        end_date: string | null
        budget: number | string
        adspend: number | string
        impressions: number | string
        clicks: number | string
        leads_generated: number
        status: string
        ad_source: string | null
        notes: string | null
        created_by: string | null
        created_at: string
        updated_at: string
        provider: string | null
        external_id: string | null
        reach: number
        meta_leads: number
        funnel_leads: number
        synced_at: string | null
        account_id: string | null
        link_clicks: number | string
        landing_views: number | string
        appointments_count: number
        shows_count: number
        sales_count: number
        sales_revenue: number | string
        account_name: string | null
        followers: number | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        channel: string | undefined
        type: string | null | undefined
        start_date: string | null | undefined
        end_date: string | null | undefined
        budget: number | string | undefined
        adspend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        leads_generated: number | undefined
        status: string | undefined
        ad_source: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        provider: string | null | undefined
        external_id: string | null | undefined
        reach: number | undefined
        meta_leads: number | undefined
        funnel_leads: number | undefined
        synced_at: string | null | undefined
        account_id: string | null | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        appointments_count: number | undefined
        shows_count: number | undefined
        sales_count: number | undefined
        sales_revenue: number | string | undefined
        account_name: string | null | undefined
        followers: number | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        channel: string | undefined
        type: string | undefined
        start_date: string | undefined
        end_date: string | undefined
        budget: number | string | undefined
        adspend: number | string | undefined
        impressions: number | string | undefined
        clicks: number | string | undefined
        leads_generated: number | undefined
        status: string | undefined
        ad_source: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        provider: string | undefined
        external_id: string | undefined
        reach: number | undefined
        meta_leads: number | undefined
        funnel_leads: number | undefined
        synced_at: string | undefined
        account_id: string | undefined
        link_clicks: number | string | undefined
        landing_views: number | string | undefined
        appointments_count: number | undefined
        shows_count: number | undefined
        sales_count: number | undefined
        sales_revenue: number | string | undefined
        account_name: string | undefined
        followers: number | undefined
        tenant_id: string | undefined
      }
    }
    CanonicalEvents: {
      Row: {
        id: string
        event_id: string
        event_name: string
        occurred_at: string
        received_at: string
        source: string
        schema_version: string
        idempotency_key: string
        visitor_id: string | null
        session_id: string | null
        touchpoint_id: string | null
        contact_id: string | null
        appointment_id: string | null
        sale_id: string | null
        revenue: number | string | null
        currency: string | null
        consent_snapshot: Json
        properties: Json
        processing_status: string
        rejection_reason: string | null
        created_at: string
        tenant_id: string
        site_id: string | null
        raw_event_id: string | null
        source_event_id: string | null
        processed_at: string | null
      }
      Insert: {
        id: string | undefined
        event_id: string
        event_name: string
        occurred_at: string
        received_at: string | undefined
        source: string
        schema_version: string | undefined
        idempotency_key: string
        visitor_id: string | null | undefined
        session_id: string | null | undefined
        touchpoint_id: string | null | undefined
        contact_id: string | null | undefined
        appointment_id: string | null | undefined
        sale_id: string | null | undefined
        revenue: number | string | null | undefined
        currency: string | null | undefined
        consent_snapshot: Json
        properties: Json
        processing_status: string | undefined
        rejection_reason: string | null | undefined
        created_at: string | undefined
        tenant_id: string
        site_id: string | null | undefined
        raw_event_id: string | null | undefined
        source_event_id: string | null | undefined
        processed_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        event_id: string | undefined
        event_name: string | undefined
        occurred_at: string | undefined
        received_at: string | undefined
        source: string | undefined
        schema_version: string | undefined
        idempotency_key: string | undefined
        visitor_id: string | undefined
        session_id: string | undefined
        touchpoint_id: string | undefined
        contact_id: string | undefined
        appointment_id: string | undefined
        sale_id: string | undefined
        revenue: number | string | undefined
        currency: string | undefined
        consent_snapshot: Json | undefined
        properties: Json | undefined
        processing_status: string | undefined
        rejection_reason: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
        site_id: string | undefined
        raw_event_id: string | undefined
        source_event_id: string | undefined
        processed_at: string | undefined
      }
    }
    CarruselBrand: {
      Row: {
        id: string
        tenant_id: string
        name: string
        colors: Json
        fonts: Json
        logo_url: string | null
        style_keywords: Json
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        name: string | undefined
        colors: Json
        fonts: Json
        logo_url: string | null | undefined
        style_keywords: Json
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        name: string | undefined
        colors: Json | undefined
        fonts: Json | undefined
        logo_url: string | undefined
        style_keywords: Json | undefined
        updated_at: string | undefined
      }
    }
    CarruselProjects: {
      Row: {
        id: string
        tenant_id: string
        title: string
        kind: string
        aspect_ratio: string
        slides: Json
        reference_images: Json
        caption: string | null
        hashtags: Json
        is_template: boolean
        created_by: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        title: string
        kind: string | undefined
        aspect_ratio: string | undefined
        slides: Json
        reference_images: Json
        caption: string | null | undefined
        hashtags: Json
        is_template: boolean | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        title: string | undefined
        kind: string | undefined
        aspect_ratio: string | undefined
        slides: Json | undefined
        reference_images: Json | undefined
        caption: string | undefined
        hashtags: Json | undefined
        is_template: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    CarruselTemplates: {
      Row: {
        id: string
        tenant_id: string
        title: string
        kind: string
        aspect_ratio: string
        slides: Json
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        title: string
        kind: string | undefined
        aspect_ratio: string | undefined
        slides: Json
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        title: string | undefined
        kind: string | undefined
        aspect_ratio: string | undefined
        slides: Json | undefined
        created_at: string | undefined
      }
    }
    CollaboratorProfiles: {
      Row: {
        id: string
        tenant_id: string
        user_id: string
        code: string
        name: string | null
        status: string
        contract_id: string | null
        contract_version: string | null
        contract_signed_at: string | null
        default_commission_percent: number | string | null
        notes: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        user_id: string
        code: string
        name: string | null | undefined
        status: string | undefined
        contract_id: string | null | undefined
        contract_version: string | null | undefined
        contract_signed_at: string | null | undefined
        default_commission_percent: number | string | null | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        code: string | undefined
        name: string | undefined
        status: string | undefined
        contract_id: string | undefined
        contract_version: string | undefined
        contract_signed_at: string | undefined
        default_commission_percent: number | string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Collections: {
      Row: {
        id: string
        sale_id: string
        expected_installment_id: string | null
        collected_at: string
        gross_amount: number | string
        commissionable_amount: number | string
        payment_method: string | null
        payment_provider: string | null
        payment_reference: string | null
        is_confirmed: boolean
        is_eligible_for_commission: boolean
        eligible_at: string | null
        status: string
        notes: string | null
        created_at: string
        updated_at: string
        recovered: boolean
        recovered_at: string | null
        processing_fee: number | string
        extra_fee: number | string
        payment_channel: string | null
        from_follow_up: boolean
        vat: number | string
        invoice_link: string | null
        billing_info: string | null
        needs_commission_review: boolean
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string
        expected_installment_id: string | null | undefined
        collected_at: string
        gross_amount: number | string
        commissionable_amount: number | string
        payment_method: string | null | undefined
        payment_provider: string | null | undefined
        payment_reference: string | null | undefined
        is_confirmed: boolean | undefined
        is_eligible_for_commission: boolean | undefined
        eligible_at: string | null | undefined
        status: string | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        recovered: boolean | undefined
        recovered_at: string | null | undefined
        processing_fee: number | string | undefined
        extra_fee: number | string | undefined
        payment_channel: string | null | undefined
        from_follow_up: boolean | undefined
        vat: number | string | undefined
        invoice_link: string | null | undefined
        billing_info: string | null | undefined
        needs_commission_review: boolean | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        expected_installment_id: string | undefined
        collected_at: string | undefined
        gross_amount: number | string | undefined
        commissionable_amount: number | string | undefined
        payment_method: string | undefined
        payment_provider: string | undefined
        payment_reference: string | undefined
        is_confirmed: boolean | undefined
        is_eligible_for_commission: boolean | undefined
        eligible_at: string | undefined
        status: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        recovered: boolean | undefined
        recovered_at: string | undefined
        processing_fee: number | string | undefined
        extra_fee: number | string | undefined
        payment_channel: string | undefined
        from_follow_up: boolean | undefined
        vat: number | string | undefined
        invoice_link: string | undefined
        billing_info: string | undefined
        needs_commission_review: boolean | undefined
        tenant_id: string | undefined
      }
    }
    CommissionInvoices: {
      Row: {
        id: string
        user_id: string
        period_month: string
        invoice_url: string | null
        amount: number | string | null
        status: string
        notes: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        user_id: string
        period_month: string
        invoice_url: string | null | undefined
        amount: number | string | null | undefined
        status: string | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        period_month: string | undefined
        invoice_url: string | undefined
        amount: number | string | undefined
        status: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CommissionRules: {
      Row: {
        id: string
        participant_type: string
        percent: number | string
        active_from: string
        active_to: string | null
        is_active: boolean
        created_at: string
        updated_at: string
        user_id: string | null
        min_cash: number | string
        max_cash: number | string | null
        label: string | null
        tramo_id: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        participant_type: string
        percent: number | string
        active_from: string
        active_to: string | null | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | null | undefined
        min_cash: number | string | undefined
        max_cash: number | string | null | undefined
        label: string | null | undefined
        tramo_id: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        participant_type: string | undefined
        percent: number | string | undefined
        active_from: string | undefined
        active_to: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | undefined
        min_cash: number | string | undefined
        max_cash: number | string | undefined
        label: string | undefined
        tramo_id: string | undefined
        tenant_id: string | undefined
      }
    }
    Commissions: {
      Row: {
        id: string
        sale_id: string
        collection_id: string | null
        refund_id: string | null
        user_id: string
        participant_type: string
        percent: number | string
        base_amount: number | string
        commission_amount: number | string
        direction: string
        status: string
        liquidation_month: string
        approved_by: string | null
        notes: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string
        collection_id: string | null | undefined
        refund_id: string | null | undefined
        user_id: string
        participant_type: string
        percent: number | string
        base_amount: number | string
        commission_amount: number | string
        direction: string | undefined
        status: string | undefined
        liquidation_month: string
        approved_by: string | null | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        collection_id: string | undefined
        refund_id: string | undefined
        user_id: string | undefined
        participant_type: string | undefined
        percent: number | string | undefined
        base_amount: number | string | undefined
        commission_amount: number | string | undefined
        direction: string | undefined
        status: string | undefined
        liquidation_month: string | undefined
        approved_by: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CompanyProfile: {
      Row: {
        id: number
        name: string
        legal_name: string | null
        cif: string | null
        address: string | null
        postal_code: string | null
        city: string | null
        country: string | null
        representative: string | null
        email: string | null
        phone: string | null
        logo_url: string | null
        email_signature: string | null
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: number | undefined
        name: string | undefined
        legal_name: string | null | undefined
        cif: string | null | undefined
        address: string | null | undefined
        postal_code: string | null | undefined
        city: string | null | undefined
        country: string | null | undefined
        representative: string | null | undefined
        email: string | null | undefined
        phone: string | null | undefined
        logo_url: string | null | undefined
        email_signature: string | null | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: number | undefined
        name: string | undefined
        legal_name: string | undefined
        cif: string | undefined
        address: string | undefined
        postal_code: string | undefined
        city: string | undefined
        country: string | undefined
        representative: string | undefined
        email: string | undefined
        phone: string | undefined
        logo_url: string | undefined
        email_signature: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ContactAttributions: {
      Row: {
        id: string
        contact_id: string
        source: string | null
        funnel: string | null
        landing_url: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        utm_content: string | null
        utm_term: string | null
        first_touch_at: string | null
        last_touch_at: string | null
        is_primary: boolean
        created_at: string
        updated_at: string
        first_utm_source: string | null
        first_utm_medium: string | null
        first_utm_campaign: string | null
        first_utm_content: string | null
        first_utm_term: string | null
        last_utm_source: string | null
        last_utm_medium: string | null
        last_utm_campaign: string | null
        last_utm_content: string | null
        last_utm_term: string | null
        tenant_id: string
        collaborator_id: string | null
        collaborator_attribution_blocked: boolean
      }
      Insert: {
        id: string | undefined
        contact_id: string
        source: string | null | undefined
        funnel: string | null | undefined
        landing_url: string | null | undefined
        utm_source: string | null | undefined
        utm_medium: string | null | undefined
        utm_campaign: string | null | undefined
        utm_content: string | null | undefined
        utm_term: string | null | undefined
        first_touch_at: string | null | undefined
        last_touch_at: string | null | undefined
        is_primary: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        first_utm_source: string | null | undefined
        first_utm_medium: string | null | undefined
        first_utm_campaign: string | null | undefined
        first_utm_content: string | null | undefined
        first_utm_term: string | null | undefined
        last_utm_source: string | null | undefined
        last_utm_medium: string | null | undefined
        last_utm_campaign: string | null | undefined
        last_utm_content: string | null | undefined
        last_utm_term: string | null | undefined
        tenant_id: string
        collaborator_id: string | null | undefined
        collaborator_attribution_blocked: boolean | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        source: string | undefined
        funnel: string | undefined
        landing_url: string | undefined
        utm_source: string | undefined
        utm_medium: string | undefined
        utm_campaign: string | undefined
        utm_content: string | undefined
        utm_term: string | undefined
        first_touch_at: string | undefined
        last_touch_at: string | undefined
        is_primary: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        first_utm_source: string | undefined
        first_utm_medium: string | undefined
        first_utm_campaign: string | undefined
        first_utm_content: string | undefined
        first_utm_term: string | undefined
        last_utm_source: string | undefined
        last_utm_medium: string | undefined
        last_utm_campaign: string | undefined
        last_utm_content: string | undefined
        last_utm_term: string | undefined
        tenant_id: string | undefined
        collaborator_id: string | undefined
        collaborator_attribution_blocked: boolean | undefined
      }
    }
    ContactLaunches: {
      Row: {
        id: string
        tenant_id: string
        contact_id: string
        launch_id: string
        created_at: string
        confirmed_at: string | null
        confirm_source: string | null
        invitado_at: string | null
        invitado_por: string | null
        utm: Json | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        contact_id: string
        launch_id: string
        created_at: string | undefined
        confirmed_at: string | null | undefined
        confirm_source: string | null | undefined
        invitado_at: string | null | undefined
        invitado_por: string | null | undefined
        utm: Json | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        contact_id: string | undefined
        launch_id: string | undefined
        created_at: string | undefined
        confirmed_at: string | undefined
        confirm_source: string | undefined
        invitado_at: string | undefined
        invitado_por: string | undefined
        utm: Json | undefined
      }
    }
    ContactNotes: {
      Row: {
        id: string
        contact_id: string
        author_id: string | null
        note: string
        pinned: boolean
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        contact_id: string
        author_id: string | null | undefined
        note: string
        pinned: boolean | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        author_id: string | undefined
        note: string | undefined
        pinned: boolean | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Contacts: {
      Row: {
        id: string
        first_name: string | null
        last_name: string | null
        full_name: string
        email: string | null
        phone: string | null
        country: string | null
        company_name: string | null
        notes: string | null
        first_seen_at: string | null
        last_seen_at: string | null
        created_at: string
        updated_at: string
        instagram: string | null
        lead_channel: string | null
        lead_status: string
        vsl_watch_pct: number | string | null
        vsl_watched_at: string | null
        lead_score: number | null
        first_contact_at: string | null
        contact_attempts: number
        discard_reason: string | null
        referred_by: string | null
        campaign_id: string | null
        set_source: string | null
        optin_date: string | null
        gender: string | null
        age: number | null
        engagement_score: string | null
        ttfv_date: string | null
        nps: number | null
        nps_date: string | null
        promise_fulfilled: string | null
        ghl_contact_id: string | null
        qualification: Json | null
        qualification_updated_at: string | null
        tenant_id: string
        merged_into: string | null
        email_normalized: string | null
        phone_normalized: string | null
        lifecycle: string | null
        custom_fields: Json
      }
      Insert: {
        id: string | undefined
        first_name: string | null | undefined
        last_name: string | null | undefined
        full_name: string
        email: string | null | undefined
        phone: string | null | undefined
        country: string | null | undefined
        company_name: string | null | undefined
        notes: string | null | undefined
        first_seen_at: string | null | undefined
        last_seen_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        instagram: string | null | undefined
        lead_channel: string | null | undefined
        lead_status: string | undefined
        vsl_watch_pct: number | string | null | undefined
        vsl_watched_at: string | null | undefined
        lead_score: number | null | undefined
        first_contact_at: string | null | undefined
        contact_attempts: number | undefined
        discard_reason: string | null | undefined
        referred_by: string | null | undefined
        campaign_id: string | null | undefined
        set_source: string | null | undefined
        optin_date: string | null | undefined
        gender: string | null | undefined
        age: number | null | undefined
        engagement_score: string | null | undefined
        ttfv_date: string | null | undefined
        nps: number | null | undefined
        nps_date: string | null | undefined
        promise_fulfilled: string | null | undefined
        ghl_contact_id: string | null | undefined
        qualification: Json | null | undefined
        qualification_updated_at: string | null | undefined
        tenant_id: string
        merged_into: string | null | undefined
        email_normalized: string | null | undefined
        phone_normalized: string | null | undefined
        lifecycle: string | null | undefined
        custom_fields: Json
      }
      Update: {
        id: string | undefined
        first_name: string | undefined
        last_name: string | undefined
        full_name: string | undefined
        email: string | undefined
        phone: string | undefined
        country: string | undefined
        company_name: string | undefined
        notes: string | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        instagram: string | undefined
        lead_channel: string | undefined
        lead_status: string | undefined
        vsl_watch_pct: number | string | undefined
        vsl_watched_at: string | undefined
        lead_score: number | undefined
        first_contact_at: string | undefined
        contact_attempts: number | undefined
        discard_reason: string | undefined
        referred_by: string | undefined
        campaign_id: string | undefined
        set_source: string | undefined
        optin_date: string | undefined
        gender: string | undefined
        age: number | undefined
        engagement_score: string | undefined
        ttfv_date: string | undefined
        nps: number | undefined
        nps_date: string | undefined
        promise_fulfilled: string | undefined
        ghl_contact_id: string | undefined
        qualification: Json | undefined
        qualification_updated_at: string | undefined
        tenant_id: string | undefined
        merged_into: string | undefined
        email_normalized: string | undefined
        phone_normalized: string | undefined
        lifecycle: string | undefined
        custom_fields: Json | undefined
      }
    }
    ContentItems: {
      Row: {
        id: string
        title: string
        content_type: string
        status: string
        link_url: string | null
        publish_date: string | null
        assigned_to: string | null
        notes: string | null
        created_by: string | null
        created_at: string
        updated_at: string
        solution_explanation: string | null
        solution_link: string | null
        reference_reel_url: string | null
        reference_transcript: string | null
        our_reel_url: string | null
        script: string | null
        testimonio_id: string | null
        sort_order: number | null
        price: number | string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        title: string
        content_type: string | undefined
        status: string | undefined
        link_url: string | null | undefined
        publish_date: string | null | undefined
        assigned_to: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        solution_explanation: string | null | undefined
        solution_link: string | null | undefined
        reference_reel_url: string | null | undefined
        reference_transcript: string | null | undefined
        our_reel_url: string | null | undefined
        script: string | null | undefined
        testimonio_id: string | null | undefined
        sort_order: number | null | undefined
        price: number | string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        title: string | undefined
        content_type: string | undefined
        status: string | undefined
        link_url: string | undefined
        publish_date: string | undefined
        assigned_to: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        solution_explanation: string | undefined
        solution_link: string | undefined
        reference_reel_url: string | undefined
        reference_transcript: string | undefined
        our_reel_url: string | undefined
        script: string | undefined
        testimonio_id: string | undefined
        sort_order: number | undefined
        price: number | string | undefined
        tenant_id: string | undefined
      }
    }
    ContractTemplates: {
      Row: {
        id: string
        name: string
        role_key: string | null
        body: string
        is_active: boolean
        created_by: string | null
        created_at: string
        updated_at: string
        kind: string
        welcome_message: string | null
        payment_method: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        role_key: string | null | undefined
        body: string
        is_active: boolean | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        kind: string | undefined
        welcome_message: string | null | undefined
        payment_method: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        role_key: string | undefined
        body: string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        kind: string | undefined
        welcome_message: string | undefined
        payment_method: string | undefined
        tenant_id: string | undefined
      }
    }
    Contracts: {
      Row: {
        id: string
        sale_id: string | null
        contact_id: string | null
        title: string | null
        url: string | null
        status: string
        signed_at: string | null
        notes: string | null
        created_by: string | null
        created_at: string
        updated_at: string
        user_id: string | null
        template_id: string | null
        kind: string
        signing_token: string | null
        terms: Json | null
        body_snapshot: string | null
        sent_at: string | null
        signer_name: string | null
        signer_ip: string | null
        signer_user_agent: string | null
        signed_hash: string | null
        signed_pdf_url: string | null
        signer_data: Json | null
        contract_role: string | null
        email_sent_at: string | null
        read_at: string | null
        accesos_enviados_at: string | null
        accesos_abiertos_at: string | null
        onboarding_webhook_ok: boolean | null
        is_reservation: boolean
        contract_party: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string | null | undefined
        contact_id: string | null | undefined
        title: string | null | undefined
        url: string | null | undefined
        status: string | undefined
        signed_at: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | null | undefined
        template_id: string | null | undefined
        kind: string | undefined
        signing_token: string | null | undefined
        terms: Json | null | undefined
        body_snapshot: string | null | undefined
        sent_at: string | null | undefined
        signer_name: string | null | undefined
        signer_ip: string | null | undefined
        signer_user_agent: string | null | undefined
        signed_hash: string | null | undefined
        signed_pdf_url: string | null | undefined
        signer_data: Json | null | undefined
        contract_role: string | null | undefined
        email_sent_at: string | null | undefined
        read_at: string | null | undefined
        accesos_enviados_at: string | null | undefined
        accesos_abiertos_at: string | null | undefined
        onboarding_webhook_ok: boolean | null | undefined
        is_reservation: boolean | undefined
        contract_party: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        contact_id: string | undefined
        title: string | undefined
        url: string | undefined
        status: string | undefined
        signed_at: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | undefined
        template_id: string | undefined
        kind: string | undefined
        signing_token: string | undefined
        terms: Json | undefined
        body_snapshot: string | undefined
        sent_at: string | undefined
        signer_name: string | undefined
        signer_ip: string | undefined
        signer_user_agent: string | undefined
        signed_hash: string | undefined
        signed_pdf_url: string | undefined
        signer_data: Json | undefined
        contract_role: string | undefined
        email_sent_at: string | undefined
        read_at: string | undefined
        accesos_enviados_at: string | undefined
        accesos_abiertos_at: string | undefined
        onboarding_webhook_ok: boolean | undefined
        is_reservation: boolean | undefined
        contract_party: string | undefined
        tenant_id: string | undefined
      }
    }
    ConversationEvents: {
      Row: {
        id: string
        tenant_id: string
        conversation_id: string
        actor_user_id: string | null
        kind: string
        data: Json
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        conversation_id: string
        actor_user_id: string | null | undefined
        kind: string
        data: Json
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        actor_user_id: string | undefined
        kind: string | undefined
        data: Json | undefined
        created_at: string | undefined
      }
    }
    ConversationMessages: {
      Row: {
        id: string
        tenant_id: string
        conversation_id: string
        external_id: string
        direction: string
        author: string
        body: string
        sent_at: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        conversation_id: string
        external_id: string
        direction: string
        author: string
        body: string | undefined
        sent_at: string
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        external_id: string | undefined
        direction: string | undefined
        author: string | undefined
        body: string | undefined
        sent_at: string | undefined
        created_at: string | undefined
      }
    }
    ConversationNotes: {
      Row: {
        id: string
        tenant_id: string
        conversation_id: string
        author_user_id: string | null
        body: string
        pinned: boolean
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        conversation_id: string
        author_user_id: string | null | undefined
        body: string
        pinned: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        conversation_id: string | undefined
        author_user_id: string | undefined
        body: string | undefined
        pinned: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Conversations: {
      Row: {
        id: string
        tenant_id: string
        external_id: string
        source: string
        channel: string
        contact_id: string | null
        contact_external_id: string | null
        status: string
        snoozed_until: string | null
        assignee_id: string | null
        ai_mode: string
        labels: string[]
        last_inbound_at: string | null
        last_message_at: string | null
        first_reply_at: string | null
        unread_count: number
        summary: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        external_id: string
        source: string | undefined
        channel: string | undefined
        contact_id: string | null | undefined
        contact_external_id: string | null | undefined
        status: string | undefined
        snoozed_until: string | null | undefined
        assignee_id: string | null | undefined
        ai_mode: string | undefined
        labels: string[]
        last_inbound_at: string | null | undefined
        last_message_at: string | null | undefined
        first_reply_at: string | null | undefined
        unread_count: number | undefined
        summary: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        external_id: string | undefined
        source: string | undefined
        channel: string | undefined
        contact_id: string | undefined
        contact_external_id: string | undefined
        status: string | undefined
        snoozed_until: string | undefined
        assignee_id: string | undefined
        ai_mode: string | undefined
        labels: string[] | undefined
        last_inbound_at: string | undefined
        last_message_at: string | undefined
        first_reply_at: string | undefined
        unread_count: number | undefined
        summary: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    CsmEvents: {
      Row: {
        id: string
        contact_id: string
        sale_id: string | null
        csm_id: string | null
        type: string
        event_datetime: string
        status: string
        grade: number | null
        success: string | null
        reminder: string | null
        recording_url: string | null
        notes: string | null
        created_by: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        contact_id: string
        sale_id: string | null | undefined
        csm_id: string | null | undefined
        type: string | undefined
        event_datetime: string | undefined
        status: string | undefined
        grade: number | null | undefined
        success: string | null | undefined
        reminder: string | null | undefined
        recording_url: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        sale_id: string | undefined
        csm_id: string | undefined
        type: string | undefined
        event_datetime: string | undefined
        status: string | undefined
        grade: number | undefined
        success: string | undefined
        reminder: string | undefined
        recording_url: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    CustomFieldDefs: {
      Row: {
        id: string
        tenant_id: string
        field_key: string
        label: string
        field_type: string
        sort_order: number
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        field_key: string
        label: string
        field_type: string | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        field_key: string | undefined
        label: string | undefined
        field_type: string | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    DeletedAppointmentsLog: {
      Row: {
        id: string
        appointment_id: string
        contact_id: string | null
        snapshot: Json
        reason: string | null
        deleted_by: string | null
        deleted_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        appointment_id: string
        contact_id: string | null | undefined
        snapshot: Json
        reason: string | null | undefined
        deleted_by: string | null | undefined
        deleted_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        appointment_id: string | undefined
        contact_id: string | undefined
        snapshot: Json | undefined
        reason: string | undefined
        deleted_by: string | undefined
        deleted_at: string | undefined
        tenant_id: string | undefined
      }
    }
    DeliveryAttempts: {
      Row: {
        id: string
        event_id: string
        destination: string
        status: string
        http_status: number | null
        latency_ms: number | null
        attempt_number: number
        last_error: string | null
        next_retry_at: string | null
        response_summary: Json
        sent_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        event_id: string
        destination: string
        status: string | undefined
        http_status: number | null | undefined
        latency_ms: number | null | undefined
        attempt_number: number | undefined
        last_error: string | null | undefined
        next_retry_at: string | null | undefined
        response_summary: Json
        sent_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        event_id: string | undefined
        destination: string | undefined
        status: string | undefined
        http_status: number | undefined
        latency_ms: number | undefined
        attempt_number: number | undefined
        last_error: string | undefined
        next_retry_at: string | undefined
        response_summary: Json | undefined
        sent_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    DocumentVerifications: {
      Row: {
        id: string
        sale_id: string
        contact_id: string
        country_code: string | null
        document_type: string | null
        document_url: string
        verified_at: string | null
        verified_by: string | null
        status: string
        rejection_reason: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string
        contact_id: string
        country_code: string | null | undefined
        document_type: string | null | undefined
        document_url: string
        verified_at: string | null | undefined
        verified_by: string | null | undefined
        status: string | undefined
        rejection_reason: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        contact_id: string | undefined
        country_code: string | undefined
        document_type: string | undefined
        document_url: string | undefined
        verified_at: string | undefined
        verified_by: string | undefined
        status: string | undefined
        rejection_reason: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Drops: {
      Row: {
        id: string
        sale_id: string | null
        contact_id: string
        request_date: string | null
        effective_date: string | null
        reason: string | null
        reason_detail: string | null
        type: string
        handled_by: string | null
        retention_action: string | null
        result: string
        refund_amount: number | string
        notes: string | null
        created_by: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string | null | undefined
        contact_id: string
        request_date: string | null | undefined
        effective_date: string | null | undefined
        reason: string | null | undefined
        reason_detail: string | null | undefined
        type: string | undefined
        handled_by: string | null | undefined
        retention_action: string | null | undefined
        result: string | undefined
        refund_amount: number | string | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        contact_id: string | undefined
        request_date: string | undefined
        effective_date: string | undefined
        reason: string | undefined
        reason_detail: string | undefined
        type: string | undefined
        handled_by: string | undefined
        retention_action: string | undefined
        result: string | undefined
        refund_amount: number | string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    EmailEvents: {
      Row: {
        id: string
        tenant_id: string
        email_message_id: string
        provider: string
        provider_event_id: string
        event_type: string
        event_payload: Json | null
        event_timestamp: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        email_message_id: string
        provider: string | undefined
        provider_event_id: string
        event_type: string
        event_payload: Json | null | undefined
        event_timestamp: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        email_message_id: string | undefined
        provider: string | undefined
        provider_event_id: string | undefined
        event_type: string | undefined
        event_payload: Json | undefined
        event_timestamp: string | undefined
        created_at: string | undefined
      }
    }
    EmailInvoices: {
      Row: {
        id: string
        tenant_id: string
        provider: string
        message_id: string
        attachment_id: string
        sha256: string
        from_email: string | null
        subject: string | null
        received_at: string | null
        file_name: string
        mime_type: string
        size_bytes: number | string
        storage_path: string
        status: string
        expense_id: string | null
        notes: string | null
        validated_by: string | null
        validated_at: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        provider: string | undefined
        message_id: string
        attachment_id: string
        sha256: string
        from_email: string | null | undefined
        subject: string | null | undefined
        received_at: string | null | undefined
        file_name: string
        mime_type: string
        size_bytes: number | string
        storage_path: string
        status: string | undefined
        expense_id: string | null | undefined
        notes: string | null | undefined
        validated_by: string | null | undefined
        validated_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        message_id: string | undefined
        attachment_id: string | undefined
        sha256: string | undefined
        from_email: string | undefined
        subject: string | undefined
        received_at: string | undefined
        file_name: string | undefined
        mime_type: string | undefined
        size_bytes: number | string | undefined
        storage_path: string | undefined
        status: string | undefined
        expense_id: string | undefined
        notes: string | undefined
        validated_by: string | undefined
        validated_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    EmailMessages: {
      Row: {
        id: string
        tenant_id: string
        provider: string
        provider_message_id: string | null
        template_key: string
        to_email: string
        cc_json: Json | null
        bcc_json: Json | null
        from_email: string
        reply_to_email: string | null
        subject: string
        status: string
        is_test: boolean
        related_entity_type: string | null
        related_entity_id: string | null
        error_message: string | null
        sent_at: string | null
        delivered_at: string | null
        opened_at: string | null
        clicked_at: string | null
        bounced_at: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        provider: string | undefined
        provider_message_id: string | null | undefined
        template_key: string
        to_email: string
        cc_json: Json | null | undefined
        bcc_json: Json | null | undefined
        from_email: string
        reply_to_email: string | null | undefined
        subject: string
        status: string | undefined
        is_test: boolean | undefined
        related_entity_type: string | null | undefined
        related_entity_id: string | null | undefined
        error_message: string | null | undefined
        sent_at: string | null | undefined
        delivered_at: string | null | undefined
        opened_at: string | null | undefined
        clicked_at: string | null | undefined
        bounced_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        provider_message_id: string | undefined
        template_key: string | undefined
        to_email: string | undefined
        cc_json: Json | undefined
        bcc_json: Json | undefined
        from_email: string | undefined
        reply_to_email: string | undefined
        subject: string | undefined
        status: string | undefined
        is_test: boolean | undefined
        related_entity_type: string | undefined
        related_entity_id: string | undefined
        error_message: string | undefined
        sent_at: string | undefined
        delivered_at: string | undefined
        opened_at: string | undefined
        clicked_at: string | undefined
        bounced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    EmailTemplates: {
      Row: {
        id: string
        tenant_id: string
        template_key: string
        subject: string
        body_html: string
        updated_by: string | null
        created_at: string
        updated_at: string
        name: string | null
        description: string | null
        enabled: boolean
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        template_key: string
        subject: string
        body_html: string
        updated_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        name: string | null | undefined
        description: string | null | undefined
        enabled: boolean | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        template_key: string | undefined
        subject: string | undefined
        body_html: string | undefined
        updated_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        name: string | undefined
        description: string | undefined
        enabled: boolean | undefined
      }
    }
    EventTypes: {
      Row: {
        name: string
        description: string
        source: string | null
        is_active: boolean
        created_at: string
      }
      Insert: {
        name: string
        description: string
        source: string | null | undefined
        is_active: boolean | undefined
        created_at: string | undefined
      }
      Update: {
        name: string | undefined
        description: string | undefined
        source: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
      }
    }
    Expenses: {
      Row: {
        id: string
        concept: string
        category: string
        subcategory: string | null
        amount: number | string
        expense_date: string
        recurring: boolean
        frequency: string | null
        payment_method: string | null
        status: string
        counterparty: string | null
        person_id: string | null
        notes: string | null
        created_by: string | null
        created_at: string
        updated_at: string
        invoice_url: string | null
        needs_review: boolean
        ai_extracted: Json | null
        auto_source: string | null
        period: string | null
        tenant_id: string
        invoice_number: string | null
        invoice_due_date: string | null
        counterparty_tax_id: string | null
        counterparty_address: string | null
        counterparty_bank_account: string | null
        counterparty_bank_name: string | null
        paid_at: string | null
        paid_from_account: string | null
        payment_reference: string | null
      }
      Insert: {
        id: string | undefined
        concept: string
        category: string | undefined
        subcategory: string | null | undefined
        amount: number | string | undefined
        expense_date: string
        recurring: boolean | undefined
        frequency: string | null | undefined
        payment_method: string | null | undefined
        status: string | undefined
        counterparty: string | null | undefined
        person_id: string | null | undefined
        notes: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        invoice_url: string | null | undefined
        needs_review: boolean | undefined
        ai_extracted: Json | null | undefined
        auto_source: string | null | undefined
        period: string | null | undefined
        tenant_id: string
        invoice_number: string | null | undefined
        invoice_due_date: string | null | undefined
        counterparty_tax_id: string | null | undefined
        counterparty_address: string | null | undefined
        counterparty_bank_account: string | null | undefined
        counterparty_bank_name: string | null | undefined
        paid_at: string | null | undefined
        paid_from_account: string | null | undefined
        payment_reference: string | null | undefined
      }
      Update: {
        id: string | undefined
        concept: string | undefined
        category: string | undefined
        subcategory: string | undefined
        amount: number | string | undefined
        expense_date: string | undefined
        recurring: boolean | undefined
        frequency: string | undefined
        payment_method: string | undefined
        status: string | undefined
        counterparty: string | undefined
        person_id: string | undefined
        notes: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        invoice_url: string | undefined
        needs_review: boolean | undefined
        ai_extracted: Json | undefined
        auto_source: string | undefined
        period: string | undefined
        tenant_id: string | undefined
        invoice_number: string | undefined
        invoice_due_date: string | undefined
        counterparty_tax_id: string | undefined
        counterparty_address: string | undefined
        counterparty_bank_account: string | undefined
        counterparty_bank_name: string | undefined
        paid_at: string | undefined
        paid_from_account: string | undefined
        payment_reference: string | undefined
      }
    }
    FathomMatchReview: {
      Row: {
        id: string
        tenant_id: string
        fathom_meeting_id: string
        meeting_started_at: string | null
        invitee_email: string | null
        recording_url: string | null
        candidate_appointment_ids: string[]
        reason_kind: string
        reason: string
        status: string
        resolved_appointment_id: string | null
        resolved_by: string | null
        resolved_at: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        fathom_meeting_id: string
        meeting_started_at: string | null | undefined
        invitee_email: string | null | undefined
        recording_url: string | null | undefined
        candidate_appointment_ids: string[]
        reason_kind: string
        reason: string
        status: string | undefined
        resolved_appointment_id: string | null | undefined
        resolved_by: string | null | undefined
        resolved_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        fathom_meeting_id: string | undefined
        meeting_started_at: string | undefined
        invitee_email: string | undefined
        recording_url: string | undefined
        candidate_appointment_ids: string[] | undefined
        reason_kind: string | undefined
        reason: string | undefined
        status: string | undefined
        resolved_appointment_id: string | undefined
        resolved_by: string | undefined
        resolved_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    FbMedia: {
      Row: {
        id: string
        external_id: string
        description: string | null
        permalink: string | null
        created_time: string | null
        views: number
        likes: number
        comments: number
        synced_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        external_id: string
        description: string | null | undefined
        permalink: string | null | undefined
        created_time: string | null | undefined
        views: number | undefined
        likes: number | undefined
        comments: number | undefined
        synced_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        description: string | undefined
        permalink: string | undefined
        created_time: string | undefined
        views: number | undefined
        likes: number | undefined
        comments: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    FormResponses: {
      Row: {
        id: string
        tenant_id: string
        form_id: string
        version_id: string
        submission_id: string
        status: string
        answers: Json
        hidden: Json
        score: number | null
        temperature: string | null
        tags: string[]
        rating: number | null
        nps: number | null
        teacher: string | null
        module: string | null
        class_name: string | null
        outcome: string | null
        variant: string | null
        contact_id: string | null
        review_status: string
        review_notes: string | null
        device: string | null
        duration_ms: number | null
        ip_hash: string | null
        created_at: string
        completed_at: string | null
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        form_id: string
        version_id: string
        submission_id: string
        status: string | undefined
        answers: Json
        hidden: Json
        score: number | null | undefined
        temperature: string | null | undefined
        tags: string[]
        rating: number | null | undefined
        nps: number | null | undefined
        teacher: string | null | undefined
        module: string | null | undefined
        class_name: string | null | undefined
        outcome: string | null | undefined
        variant: string | null | undefined
        contact_id: string | null | undefined
        review_status: string | undefined
        review_notes: string | null | undefined
        device: string | null | undefined
        duration_ms: number | null | undefined
        ip_hash: string | null | undefined
        created_at: string | undefined
        completed_at: string | null | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        form_id: string | undefined
        version_id: string | undefined
        submission_id: string | undefined
        status: string | undefined
        answers: Json | undefined
        hidden: Json | undefined
        score: number | undefined
        temperature: string | undefined
        tags: string[] | undefined
        rating: number | undefined
        nps: number | undefined
        teacher: string | undefined
        module: string | undefined
        class_name: string | undefined
        outcome: string | undefined
        variant: string | undefined
        contact_id: string | undefined
        review_status: string | undefined
        review_notes: string | undefined
        device: string | undefined
        duration_ms: number | undefined
        ip_hash: string | undefined
        created_at: string | undefined
        completed_at: string | undefined
        updated_at: string | undefined
      }
    }
    FormSessions: {
      Row: {
        id: string
        tenant_id: string
        form_id: string
        version_id: string | null
        session_id: string
        status: string
        device: string | null
        variant: string | null
        utm: Json
        referrer_host: string | null
        last_question: string | null
        max_question_index: number
        question_times: Json
        started_at: string | null
        completed_at: string | null
        created_at: string
        last_active_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        form_id: string
        version_id: string | null | undefined
        session_id: string
        status: string | undefined
        device: string | null | undefined
        variant: string | null | undefined
        utm: Json
        referrer_host: string | null | undefined
        last_question: string | null | undefined
        max_question_index: number | undefined
        question_times: Json
        started_at: string | null | undefined
        completed_at: string | null | undefined
        created_at: string | undefined
        last_active_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        form_id: string | undefined
        version_id: string | undefined
        session_id: string | undefined
        status: string | undefined
        device: string | undefined
        variant: string | undefined
        utm: Json | undefined
        referrer_host: string | undefined
        last_question: string | undefined
        max_question_index: number | undefined
        question_times: Json | undefined
        started_at: string | undefined
        completed_at: string | undefined
        created_at: string | undefined
        last_active_at: string | undefined
      }
    }
    FormVersions: {
      Row: {
        id: string
        tenant_id: string
        form_id: string
        version: number
        config: Json
        published_by: string | null
        published_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        form_id: string
        version: number
        config: Json
        published_by: string | null | undefined
        published_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        form_id: string | undefined
        version: number | undefined
        config: Json | undefined
        published_by: string | undefined
        published_at: string | undefined
      }
    }
    FormWebhookDeliveries: {
      Row: {
        id: string
        tenant_id: string
        webhook_id: string
        response_id: string
        status: string
        attempts: number
        last_status_code: number | null
        last_error: string | null
        next_attempt_at: string | null
        created_at: string
        delivered_at: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        webhook_id: string
        response_id: string
        status: string | undefined
        attempts: number | undefined
        last_status_code: number | null | undefined
        last_error: string | null | undefined
        next_attempt_at: string | null | undefined
        created_at: string | undefined
        delivered_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        webhook_id: string | undefined
        response_id: string | undefined
        status: string | undefined
        attempts: number | undefined
        last_status_code: number | undefined
        last_error: string | undefined
        next_attempt_at: string | undefined
        created_at: string | undefined
        delivered_at: string | undefined
      }
    }
    FormWebhooks: {
      Row: {
        id: string
        tenant_id: string
        form_id: string
        url: string
        secret_enc: string
        active: boolean
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        form_id: string
        url: string
        secret_enc: string
        active: boolean | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        form_id: string | undefined
        url: string | undefined
        secret_enc: string | undefined
        active: boolean | undefined
        created_at: string | undefined
      }
    }
    Forms: {
      Row: {
        id: string
        tenant_id: string
        slug: string
        name: string
        category: string
        audience: string
        status: string
        draft_config: Json
        published_version_id: string | null
        settings: Json
        created_by: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        slug: string
        name: string
        category: string | undefined
        audience: string | undefined
        status: string | undefined
        draft_config: Json
        published_version_id: string | null | undefined
        settings: Json
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        slug: string | undefined
        name: string | undefined
        category: string | undefined
        audience: string | undefined
        status: string | undefined
        draft_config: Json | undefined
        published_version_id: string | undefined
        settings: Json | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Ga4Daily: {
      Row: {
        id: string
        tenant_id: string
        date: string
        source: string
        medium: string
        campaign: string
        landing_page: string
        device: string
        sessions: number
        active_users: number
        new_users: number
        conversions: number | string
        engaged_sessions: number
        synced_at: string
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        date: string
        source: string | undefined
        medium: string | undefined
        campaign: string | undefined
        landing_page: string | undefined
        device: string | undefined
        sessions: number | undefined
        active_users: number | undefined
        new_users: number | undefined
        conversions: number | string | undefined
        engaged_sessions: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        date: string | undefined
        source: string | undefined
        medium: string | undefined
        campaign: string | undefined
        landing_page: string | undefined
        device: string | undefined
        sessions: number | undefined
        active_users: number | undefined
        new_users: number | undefined
        conversions: number | string | undefined
        engaged_sessions: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    GoogleCalendarEvents: {
      Row: {
        id: string
        tenant_id: string
        connected_calendar_id: string
        owner_user_id: string
        provider_event_id: string
        ical_uid: string | null
        recurring_event_id: string | null
        original_start_at: string | null
        event_start_at: string | null
        event_end_at: string | null
        time_zone: string | null
        status: string
        visibility: string | null
        transparency: string | null
        attendee_fingerprints: string[]
        has_external_attendee: boolean
        is_all_day: boolean
        external_updated_at: string | null
        last_seen_at: string
        created_at: string
        updated_at: string
        appointment_id: string | null
        reconciliation_status: string
        match_method: string | null
        reconciliation_reason: string | null
        reconciled_at: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        connected_calendar_id: string
        owner_user_id: string
        provider_event_id: string
        ical_uid: string | null | undefined
        recurring_event_id: string | null | undefined
        original_start_at: string | null | undefined
        event_start_at: string | null | undefined
        event_end_at: string | null | undefined
        time_zone: string | null | undefined
        status: string
        visibility: string | null | undefined
        transparency: string | null | undefined
        attendee_fingerprints: string[]
        has_external_attendee: boolean | undefined
        is_all_day: boolean | undefined
        external_updated_at: string | null | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        appointment_id: string | null | undefined
        reconciliation_status: string | undefined
        match_method: string | null | undefined
        reconciliation_reason: string | null | undefined
        reconciled_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        connected_calendar_id: string | undefined
        owner_user_id: string | undefined
        provider_event_id: string | undefined
        ical_uid: string | undefined
        recurring_event_id: string | undefined
        original_start_at: string | undefined
        event_start_at: string | undefined
        event_end_at: string | undefined
        time_zone: string | undefined
        status: string | undefined
        visibility: string | undefined
        transparency: string | undefined
        attendee_fingerprints: string[] | undefined
        has_external_attendee: boolean | undefined
        is_all_day: boolean | undefined
        external_updated_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        appointment_id: string | undefined
        reconciliation_status: string | undefined
        match_method: string | undefined
        reconciliation_reason: string | undefined
        reconciled_at: string | undefined
      }
    }
    GoogleConnectedCalendars: {
      Row: {
        id: string
        tenant_id: string
        connection_id: string
        owner_user_id: string
        external_calendar_id: string
        calendar_name: string
        role: string
        time_zone: string | null
        is_enabled: boolean
        last_sync_at: string | null
        last_error_code: string | null
        created_at: string
        updated_at: string
        sync_token: string | null
        last_full_sync_at: string | null
        last_incremental_sync_at: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        connection_id: string
        owner_user_id: string
        external_calendar_id: string
        calendar_name: string
        role: string
        time_zone: string | null | undefined
        is_enabled: boolean | undefined
        last_sync_at: string | null | undefined
        last_error_code: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        sync_token: string | null | undefined
        last_full_sync_at: string | null | undefined
        last_incremental_sync_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        connection_id: string | undefined
        owner_user_id: string | undefined
        external_calendar_id: string | undefined
        calendar_name: string | undefined
        role: string | undefined
        time_zone: string | undefined
        is_enabled: boolean | undefined
        last_sync_at: string | undefined
        last_error_code: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        sync_token: string | undefined
        last_full_sync_at: string | undefined
        last_incremental_sync_at: string | undefined
      }
    }
    GoogleOauthConnections: {
      Row: {
        id: string
        tenant_id: string
        provider: string
        google_email: string | null
        refresh_token: string
        scopes: string[]
        ga4_property_id: string | null
        status: string
        last_sync_at: string | null
        last_error: string | null
        connected_by: string | null
        created_at: string
        updated_at: string
        owner_user_id: string | null
        access_token: string | null
        access_token_expires_at: string | null
        last_refresh_at: string | null
        reauth_required_at: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        provider: string
        google_email: string | null | undefined
        refresh_token: string
        scopes: string[]
        ga4_property_id: string | null | undefined
        status: string | undefined
        last_sync_at: string | null | undefined
        last_error: string | null | undefined
        connected_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        owner_user_id: string | null | undefined
        access_token: string | null | undefined
        access_token_expires_at: string | null | undefined
        last_refresh_at: string | null | undefined
        reauth_required_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        google_email: string | undefined
        refresh_token: string | undefined
        scopes: string[] | undefined
        ga4_property_id: string | undefined
        status: string | undefined
        last_sync_at: string | undefined
        last_error: string | undefined
        connected_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        owner_user_id: string | undefined
        access_token: string | undefined
        access_token_expires_at: string | undefined
        last_refresh_at: string | undefined
        reauth_required_at: string | undefined
      }
    }
    GrowthContext: {
      Row: {
        tenant_id: string
        business_type: string | null
        offer_name: string | null
        offer_price_eur: number | string | null
        sales_cycle_days: number | null
        target_monthly_revenue_eur: number | string | null
        target_ltgp_cac: number | string | null
        target_cash_roas: number | string | null
        capacity_calls_per_week: number | null
        capacity_active_clients: number | null
        notes: string | null
        updated_by: string | null
        created_at: string
        updated_at: string
        avg_delivery_cost_eur: number | string | null
      }
      Insert: {
        tenant_id: string
        business_type: string | null | undefined
        offer_name: string | null | undefined
        offer_price_eur: number | string | null | undefined
        sales_cycle_days: number | null | undefined
        target_monthly_revenue_eur: number | string | null | undefined
        target_ltgp_cac: number | string | null | undefined
        target_cash_roas: number | string | null | undefined
        capacity_calls_per_week: number | null | undefined
        capacity_active_clients: number | null | undefined
        notes: string | null | undefined
        updated_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        avg_delivery_cost_eur: number | string | null | undefined
      }
      Update: {
        tenant_id: string | undefined
        business_type: string | undefined
        offer_name: string | undefined
        offer_price_eur: number | string | undefined
        sales_cycle_days: number | undefined
        target_monthly_revenue_eur: number | string | undefined
        target_ltgp_cac: number | string | undefined
        target_cash_roas: number | string | undefined
        capacity_calls_per_week: number | undefined
        capacity_active_clients: number | undefined
        notes: string | undefined
        updated_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        avg_delivery_cost_eur: number | string | undefined
      }
    }
    IdentityMatches: {
      Row: {
        id: string
        event_id: string | null
        contact_id: string | null
        method: string
        confidence: number | string
        reason: string
        status: string
        evidence: Json
        reviewed_by: string | null
        reviewed_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        event_id: string | null | undefined
        contact_id: string | null | undefined
        method: string
        confidence: number | string
        reason: string
        status: string | undefined
        evidence: Json
        reviewed_by: string | null | undefined
        reviewed_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        event_id: string | undefined
        contact_id: string | undefined
        method: string | undefined
        confidence: number | string | undefined
        reason: string | undefined
        status: string | undefined
        evidence: Json | undefined
        reviewed_by: string | undefined
        reviewed_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgAccountDaily: {
      Row: {
        id: string
        snapshot_date: string
        followers_count: number
        media_count: number
        reach: number
        profile_views: number
        new_follows: number
        unfollows: number
        reach_followers: number
        reach_non_followers: number
        synced_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        snapshot_date: string
        followers_count: number | undefined
        media_count: number | undefined
        reach: number | undefined
        profile_views: number | undefined
        new_follows: number | undefined
        unfollows: number | undefined
        reach_followers: number | undefined
        reach_non_followers: number | undefined
        synced_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        snapshot_date: string | undefined
        followers_count: number | undefined
        media_count: number | undefined
        reach: number | undefined
        profile_views: number | undefined
        new_follows: number | undefined
        unfollows: number | undefined
        reach_followers: number | undefined
        reach_non_followers: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgAudience: {
      Row: {
        id: string
        dimension: string
        bucket: string
        value: number
        captured_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        dimension: string
        bucket: string
        value: number | undefined
        captured_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        dimension: string | undefined
        bucket: string | undefined
        value: number | undefined
        captured_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgComments: {
      Row: {
        id: string
        external_id: string
        media_external_id: string | null
        username: string | null
        text: string | null
        like_count: number
        commented_at: string | null
        synced_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        external_id: string
        media_external_id: string | null | undefined
        username: string | null | undefined
        text: string | null | undefined
        like_count: number | undefined
        commented_at: string | null | undefined
        synced_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        media_external_id: string | undefined
        username: string | undefined
        text: string | undefined
        like_count: number | undefined
        commented_at: string | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgCompetitorMedia: {
      Row: {
        id: string
        competitor_id: string
        external_id: string
        caption: string | null
        media_type: string | null
        media_product_type: string | null
        like_count: number
        comments_count: number
        engagement_proxy: number
        permalink: string | null
        media_url: string | null
        thumbnail_url: string | null
        published_at: string | null
        transcript: string | null
        ai_analysis: Json | null
        synced_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        competitor_id: string
        external_id: string
        caption: string | null | undefined
        media_type: string | null | undefined
        media_product_type: string | null | undefined
        like_count: number | undefined
        comments_count: number | undefined
        engagement_proxy: number | undefined
        permalink: string | null | undefined
        media_url: string | null | undefined
        thumbnail_url: string | null | undefined
        published_at: string | null | undefined
        transcript: string | null | undefined
        ai_analysis: Json | null | undefined
        synced_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        competitor_id: string | undefined
        external_id: string | undefined
        caption: string | undefined
        media_type: string | undefined
        media_product_type: string | undefined
        like_count: number | undefined
        comments_count: number | undefined
        engagement_proxy: number | undefined
        permalink: string | undefined
        media_url: string | undefined
        thumbnail_url: string | undefined
        published_at: string | undefined
        transcript: string | undefined
        ai_analysis: Json | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgCompetitors: {
      Row: {
        id: string
        username: string
        followers_count: number
        media_count: number
        note: string | null
        last_synced_at: string | null
        created_by: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        username: string
        followers_count: number | undefined
        media_count: number | undefined
        note: string | null | undefined
        last_synced_at: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        username: string | undefined
        followers_count: number | undefined
        media_count: number | undefined
        note: string | undefined
        last_synced_at: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgConversationsDaily: {
      Row: {
        id: string
        snapshot_date: string
        total_conversations: number
        unread_conversations: number
        total_messages: number
        unique_people: number
        synced_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        snapshot_date: string
        total_conversations: number | undefined
        unread_conversations: number | undefined
        total_messages: number | undefined
        unique_people: number | undefined
        synced_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        snapshot_date: string | undefined
        total_conversations: number | undefined
        unread_conversations: number | undefined
        total_messages: number | undefined
        unique_people: number | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IgMedia: {
      Row: {
        id: string
        external_id: string
        media_type: string | null
        media_product_type: string | null
        caption: string | null
        permalink: string | null
        thumbnail_url: string | null
        media_url: string | null
        published_at: string | null
        reach: number
        views: number
        likes: number
        comments: number
        shares: number
        saved: number
        total_interactions: number
        avg_watch_time: number | string
        reach_followers: number
        reach_non_followers: number
        follows: number
        engagement_rate: number | string
        transcript: string | null
        transcript_status: string
        ai_analysis: Json | null
        ai_analyzed_at: string | null
        synced_at: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        external_id: string
        media_type: string | null | undefined
        media_product_type: string | null | undefined
        caption: string | null | undefined
        permalink: string | null | undefined
        thumbnail_url: string | null | undefined
        media_url: string | null | undefined
        published_at: string | null | undefined
        reach: number | undefined
        views: number | undefined
        likes: number | undefined
        comments: number | undefined
        shares: number | undefined
        saved: number | undefined
        total_interactions: number | undefined
        avg_watch_time: number | string | undefined
        reach_followers: number | undefined
        reach_non_followers: number | undefined
        follows: number | undefined
        engagement_rate: number | string | undefined
        transcript: string | null | undefined
        transcript_status: string | undefined
        ai_analysis: Json | null | undefined
        ai_analyzed_at: string | null | undefined
        synced_at: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        external_id: string | undefined
        media_type: string | undefined
        media_product_type: string | undefined
        caption: string | undefined
        permalink: string | undefined
        thumbnail_url: string | undefined
        media_url: string | undefined
        published_at: string | undefined
        reach: number | undefined
        views: number | undefined
        likes: number | undefined
        comments: number | undefined
        shares: number | undefined
        saved: number | undefined
        total_interactions: number | undefined
        avg_watch_time: number | string | undefined
        reach_followers: number | undefined
        reach_non_followers: number | undefined
        follows: number | undefined
        engagement_rate: number | string | undefined
        transcript: string | undefined
        transcript_status: string | undefined
        ai_analysis: Json | undefined
        ai_analyzed_at: string | undefined
        synced_at: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    IntegrationSettings: {
      Row: {
        key: string
        value: string | null
        is_secret: boolean
        label: string | null
        updated_at: string
        updated_by: string | null
        tenant_id: string
        key_fingerprint: string | null
      }
      Insert: {
        key: string
        value: string | null | undefined
        is_secret: boolean | undefined
        label: string | null | undefined
        updated_at: string | undefined
        updated_by: string | null | undefined
        tenant_id: string
        key_fingerprint: string | null | undefined
      }
      Update: {
        key: string | undefined
        value: string | undefined
        is_secret: boolean | undefined
        label: string | undefined
        updated_at: string | undefined
        updated_by: string | undefined
        tenant_id: string | undefined
        key_fingerprint: string | undefined
      }
    }
    IntegrationSyncRuns: {
      Row: {
        id: string
        tenant_id: string
        provider: string
        job: string
        status: string
        trigger: string
        started_at: string
        finished_at: string | null
        rows_written: number | null
        error_code: string | null
        error_message: string | null
        detail: Json | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        provider: string
        job: string
        status: string
        trigger: string
        started_at: string | undefined
        finished_at: string | null | undefined
        rows_written: number | null | undefined
        error_code: string | null | undefined
        error_message: string | null | undefined
        detail: Json | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        provider: string | undefined
        job: string | undefined
        status: string | undefined
        trigger: string | undefined
        started_at: string | undefined
        finished_at: string | undefined
        rows_written: number | undefined
        error_code: string | undefined
        error_message: string | undefined
        detail: Json | undefined
        created_at: string | undefined
      }
    }
    KnowledgeChunks: {
      Row: {
        id: string
        tenant_id: string
        source: string
        module: number
        section: string
        category: string
        title: string
        content: string
        metadata: Json
        is_active: boolean
        created_at: string
        updated_at: string
        embedding: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        source: string
        module: number
        section: string
        category: string
        title: string
        content: string
        metadata: Json
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        embedding: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        source: string | undefined
        module: number | undefined
        section: string | undefined
        category: string | undefined
        title: string | undefined
        content: string | undefined
        metadata: Json | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        embedding: string | undefined
      }
    }
    KpiDailyReports: {
      Row: {
        id: string
        user_id: string
        role_key: string
        report_date: string
        data: Json
        submitted_at: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        user_id: string
        role_key: string
        report_date: string
        data: Json
        submitted_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        role_key: string | undefined
        report_date: string | undefined
        data: Json | undefined
        submitted_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    KpiFormTemplates: {
      Row: {
        id: string
        role_key: string
        field_key: string
        field_label: string
        field_type: string
        placeholder: string | null
        help_text: string | null
        is_required: boolean
        is_active: boolean
        sort_order: number
        select_options: Json | null
        default_value: Json | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        role_key: string
        field_key: string
        field_label: string
        field_type: string | undefined
        placeholder: string | null | undefined
        help_text: string | null | undefined
        is_required: boolean | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        select_options: Json | null | undefined
        default_value: Json | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        role_key: string | undefined
        field_key: string | undefined
        field_label: string | undefined
        field_type: string | undefined
        placeholder: string | undefined
        help_text: string | undefined
        is_required: boolean | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        select_options: Json | undefined
        default_value: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Launches: {
      Row: {
        id: string
        tenant_id: string
        slug: string
        label: string
        fecha: string
        opened_at: string | null
        opened_by: string | null
        movidos: number | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        slug: string
        label: string
        fecha: string
        opened_at: string | null | undefined
        opened_by: string | null | undefined
        movidos: number | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        slug: string | undefined
        label: string | undefined
        fecha: string | undefined
        opened_at: string | undefined
        opened_by: string | undefined
        movidos: number | undefined
        created_at: string | undefined
      }
    }
    LinkTemplates: {
      Row: {
        id: string
        name: string
        base_url: string
        applies_to: string[]
        is_active: boolean
        created_by: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        base_url: string
        applies_to: string[]
        is_active: boolean | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        base_url: string | undefined
        applies_to: string[] | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ManualPlatformRecords: {
      Row: {
        id: string
        tenant_id: string
        platform: string
        reference: string | null
        amount: number | string
        transacted_at: string
        notes: string | null
        matched_collection_id: string | null
        created_by: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        platform: string
        reference: string | null | undefined
        amount: number | string
        transacted_at: string
        notes: string | null | undefined
        matched_collection_id: string | null | undefined
        created_by: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        platform: string | undefined
        reference: string | undefined
        amount: number | string | undefined
        transacted_at: string | undefined
        notes: string | undefined
        matched_collection_id: string | undefined
        created_by: string | undefined
        created_at: string | undefined
      }
    }
    McpOauthClients: {
      Row: {
        id: string
        client_id: string
        client_secret_hash: string
        name: string
        owner_user_id: string | null
        redirect_uris: string[]
        created_at: string
      }
      Insert: {
        id: string | undefined
        client_id: string
        client_secret_hash: string
        name: string
        owner_user_id: string | null | undefined
        redirect_uris: string[]
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        client_id: string | undefined
        client_secret_hash: string | undefined
        name: string | undefined
        owner_user_id: string | undefined
        redirect_uris: string[] | undefined
        created_at: string | undefined
      }
    }
    McpOauthCodes: {
      Row: {
        id: string
        code_hash: string
        client_id: string
        user_id: string
        redirect_uri: string
        scope: string
        code_challenge: string
        code_challenge_method: string
        expires_at: string
        used_at: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        code_hash: string
        client_id: string
        user_id: string
        redirect_uri: string
        scope: string | undefined
        code_challenge: string
        code_challenge_method: string | undefined
        expires_at: string
        used_at: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        code_hash: string | undefined
        client_id: string | undefined
        user_id: string | undefined
        redirect_uri: string | undefined
        scope: string | undefined
        code_challenge: string | undefined
        code_challenge_method: string | undefined
        expires_at: string | undefined
        used_at: string | undefined
        created_at: string | undefined
      }
    }
    McpOauthTokens: {
      Row: {
        id: string
        token_hash: string
        refresh_hash: string | null
        client_id: string
        user_id: string
        scope: string
        expires_at: string
        revoked_at: string | null
        refresh_expires_at: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        token_hash: string
        refresh_hash: string | null | undefined
        client_id: string
        user_id: string
        scope: string | undefined
        expires_at: string
        revoked_at: string | null | undefined
        refresh_expires_at: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        token_hash: string | undefined
        refresh_hash: string | undefined
        client_id: string | undefined
        user_id: string | undefined
        scope: string | undefined
        expires_at: string | undefined
        revoked_at: string | undefined
        refresh_expires_at: string | undefined
        created_at: string | undefined
      }
    }
    MetaCustomFunnels: {
      Row: {
        id: string
        tenant_id: string
        name: string
        stages: Json
        created_by: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        name: string
        stages: Json
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        name: string | undefined
        stages: Json | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Partners: {
      Row: {
        id: string
        tenant_id: string
        name: string
        profit_percent: number | string
        notes: string | null
        is_active: boolean
        created_at: string
        updated_at: string
        user_id: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        name: string
        profit_percent: number | string
        notes: string | null | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        name: string | undefined
        profit_percent: number | string | undefined
        notes: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        user_id: string | undefined
      }
    }
    PaymentFollowUps: {
      Row: {
        id: string
        sale_id: string
        note: string
        created_by: string | null
        created_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string
        note: string
        created_by: string | null | undefined
        created_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        note: string | undefined
        created_by: string | undefined
        created_at: string | undefined
        tenant_id: string | undefined
      }
    }
    PaymentPlans: {
      Row: {
        id: string
        product_id: string
        name: string
        code: string | null
        gross_price: number | string
        number_of_payments: number
        financing_provider: string | null
        cash_collection_ratio: number | string
        is_active: boolean
        sort_order: number
        created_at: string
        updated_at: string
        method: string | null
        fee_percent: number | string
        financing_surcharge_percent: number | string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        product_id: string
        name: string
        code: string | null | undefined
        gross_price: number | string
        number_of_payments: number | undefined
        financing_provider: string | null | undefined
        cash_collection_ratio: number | string | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
        method: string | null | undefined
        fee_percent: number | string | undefined
        financing_surcharge_percent: number | string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        product_id: string | undefined
        name: string | undefined
        code: string | undefined
        gross_price: number | string | undefined
        number_of_payments: number | undefined
        financing_provider: string | undefined
        cash_collection_ratio: number | string | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
        method: string | undefined
        fee_percent: number | string | undefined
        financing_surcharge_percent: number | string | undefined
        tenant_id: string | undefined
      }
    }
    PgssSnapshotStatements: {
      Row: {
        snapshot_id: string
        queryid: number | string
        query_left: string
        calls: number | string
        total_ms: number | string
        rows_count: number | string
        mean_ms: number | string
      }
      Insert: {
        snapshot_id: string
        queryid: number | string
        query_left: string
        calls: number | string
        total_ms: number | string
        rows_count: number | string
        mean_ms: number | string
      }
      Update: {
        snapshot_id: string | undefined
        queryid: number | string | undefined
        query_left: string | undefined
        calls: number | string | undefined
        total_ms: number | string | undefined
        rows_count: number | string | undefined
        mean_ms: number | string | undefined
      }
    }
    PgssSnapshots: {
      Row: {
        id: string
        captured_at: string
        stats_reset_at: string
        note: string | null
        created_by: string
      }
      Insert: {
        id: string | undefined
        captured_at: string | undefined
        stats_reset_at: string
        note: string | null | undefined
        created_by: string | undefined
      }
      Update: {
        id: string | undefined
        captured_at: string | undefined
        stats_reset_at: string | undefined
        note: string | undefined
        created_by: string | undefined
      }
    }
    PlatformSettings: {
      Row: {
        key: string
        value: string
        is_secret: boolean
        key_fingerprint: string | null
        updated_by: string | null
        updated_at: string
      }
      Insert: {
        key: string
        value: string
        is_secret: boolean | undefined
        key_fingerprint: string | null | undefined
        updated_by: string | null | undefined
        updated_at: string | undefined
      }
      Update: {
        key: string | undefined
        value: string | undefined
        is_secret: boolean | undefined
        key_fingerprint: string | undefined
        updated_by: string | undefined
        updated_at: string | undefined
      }
    }
    PositiveNotes: {
      Row: {
        id: string
        user_id: string
        period_type: string
        period_key: string
        content: string
        is_shared: boolean
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        user_id: string
        period_type: string
        period_key: string
        content: string
        is_shared: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        period_type: string | undefined
        period_key: string | undefined
        content: string | undefined
        is_shared: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ProductExtras: {
      Row: {
        id: string
        name: string
        description: string | null
        is_active: boolean
        sort_order: number
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        description: string | null | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        description: string | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Products: {
      Row: {
        id: string
        name: string
        description: string | null
        is_active: boolean
        created_at: string
        updated_at: string
        level: number | null
        next_product_id: string | null
        max_capacity: number | null
        duration_months: number | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        description: string | null | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        level: number | null | undefined
        next_product_id: string | null | undefined
        max_capacity: number | null | undefined
        duration_months: number | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        description: string | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        level: number | undefined
        next_product_id: string | undefined
        max_capacity: number | undefined
        duration_months: number | undefined
        tenant_id: string | undefined
      }
    }
    QualificationQuestions: {
      Row: {
        id: string
        slug: string
        question_text: string | null
        field_key: string | null
        first_seen_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        slug: string
        question_text: string | null | undefined
        field_key: string | null | undefined
        first_seen_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        question_text: string | undefined
        field_key: string | undefined
        first_seen_at: string | undefined
        tenant_id: string | undefined
      }
    }
    RawEvents: {
      Row: {
        id: string
        tenant_id: string
        site_id: string | null
        source: string
        source_event_id: string | null
        source_schema_version: string | null
        normalizer_version: string | null
        received_at: string
        processed_at: string | null
        payload: Json
        payload_bytes: number
        processing_status: string
        rejection_reason: string | null
        canonical_event_id: string | null
        request_origin: string | null
        user_agent: string | null
        ip_hash: string | null
        bot_classification: string
        bot_reason: string | null
        correlation_id: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        site_id: string | null | undefined
        source: string
        source_event_id: string | null | undefined
        source_schema_version: string | null | undefined
        normalizer_version: string | null | undefined
        received_at: string | undefined
        processed_at: string | null | undefined
        payload: Json
        payload_bytes: number
        processing_status: string | undefined
        rejection_reason: string | null | undefined
        canonical_event_id: string | null | undefined
        request_origin: string | null | undefined
        user_agent: string | null | undefined
        ip_hash: string | null | undefined
        bot_classification: string | undefined
        bot_reason: string | null | undefined
        correlation_id: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        site_id: string | undefined
        source: string | undefined
        source_event_id: string | undefined
        source_schema_version: string | undefined
        normalizer_version: string | undefined
        received_at: string | undefined
        processed_at: string | undefined
        payload: Json | undefined
        payload_bytes: number | undefined
        processing_status: string | undefined
        rejection_reason: string | undefined
        canonical_event_id: string | undefined
        request_origin: string | undefined
        user_agent: string | undefined
        ip_hash: string | undefined
        bot_classification: string | undefined
        bot_reason: string | undefined
        correlation_id: string | undefined
        created_at: string | undefined
      }
    }
    ReelDrafts: {
      Row: {
        id: string
        source_media_id: string | null
        source_permalink: string | null
        source_account: string | null
        thumbnail_url: string | null
        caption: string | null
        transcript: string | null
        adapted_script: string | null
        carousel_idea: string | null
        status: string
        gen_error: string | null
        created_at: string
        draft_day: string
        created_by: string | null
        testimonio_id: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        source_media_id: string | null | undefined
        source_permalink: string | null | undefined
        source_account: string | null | undefined
        thumbnail_url: string | null | undefined
        caption: string | null | undefined
        transcript: string | null | undefined
        adapted_script: string | null | undefined
        carousel_idea: string | null | undefined
        status: string | undefined
        gen_error: string | null | undefined
        created_at: string | undefined
        draft_day: string | undefined
        created_by: string | null | undefined
        testimonio_id: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        source_media_id: string | undefined
        source_permalink: string | undefined
        source_account: string | undefined
        thumbnail_url: string | undefined
        caption: string | undefined
        transcript: string | undefined
        adapted_script: string | undefined
        carousel_idea: string | undefined
        status: string | undefined
        gen_error: string | undefined
        created_at: string | undefined
        draft_day: string | undefined
        created_by: string | undefined
        testimonio_id: string | undefined
        tenant_id: string | undefined
      }
    }
    Refunds: {
      Row: {
        id: string
        sale_id: string
        collection_id: string | null
        refund_date: string
        gross_refund_amount: number | string
        commissionable_refund_amount: number | string
        reason: string | null
        status: string
        created_by: string
        notes: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        sale_id: string
        collection_id: string | null | undefined
        refund_date: string
        gross_refund_amount: number | string
        commissionable_refund_amount: number | string
        reason: string | null | undefined
        status: string | undefined
        created_by: string
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        collection_id: string | undefined
        refund_date: string | undefined
        gross_refund_amount: number | string | undefined
        commissionable_refund_amount: number | string | undefined
        reason: string | undefined
        status: string | undefined
        created_by: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    ReservationRefundRequests: {
      Row: {
        id: string
        tenant_id: string
        sale_id: string
        collection_id: string
        charge_id: string
        stripe_account_id: string
        amount_cents: number | string
        requested_by: string
        status: string
        stripe_refund_id: string | null
        refund_id: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        sale_id: string
        collection_id: string
        charge_id: string
        stripe_account_id: string
        amount_cents: number | string
        requested_by: string
        status: string | undefined
        stripe_refund_id: string | null | undefined
        refund_id: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        sale_id: string | undefined
        collection_id: string | undefined
        charge_id: string | undefined
        stripe_account_id: string | undefined
        amount_cents: number | string | undefined
        requested_by: string | undefined
        status: string | undefined
        stripe_refund_id: string | undefined
        refund_id: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    ResourceLinkDivisions: {
      Row: {
        id: string
        name: string
        sort_order: number
        created_by: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        name: string
        sort_order: number | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        name: string | undefined
        sort_order: number | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    ResourceLinks: {
      Row: {
        id: string
        category: string
        name: string
        url: string
        description: string | null
        applies_to: string[]
        is_active: boolean
        sort_order: number
        created_by: string | null
        created_at: string
        updated_at: string
        division_id: string | null
      }
      Insert: {
        id: string | undefined
        category: string | undefined
        name: string
        url: string
        description: string | null | undefined
        applies_to: string[]
        is_active: boolean | undefined
        sort_order: number | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        division_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        category: string | undefined
        name: string | undefined
        url: string | undefined
        description: string | undefined
        applies_to: string[] | undefined
        is_active: boolean | undefined
        sort_order: number | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        division_id: string | undefined
      }
    }
    Roleplays: {
      Row: {
        id: string
        title: string
        description: string | null
        participant_id: string | null
        participant_name: string | null
        recording_url: string | null
        transcript_url: string | null
        transcript: string | null
        score: number | string | null
        notes: string | null
        shared: boolean
        created_by: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        title: string
        description: string | null | undefined
        participant_id: string | null | undefined
        participant_name: string | null | undefined
        recording_url: string | null | undefined
        transcript_url: string | null | undefined
        transcript: string | null | undefined
        score: number | string | null | undefined
        notes: string | null | undefined
        shared: boolean | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        title: string | undefined
        description: string | undefined
        participant_id: string | undefined
        participant_name: string | undefined
        recording_url: string | undefined
        transcript_url: string | undefined
        transcript: string | undefined
        score: number | string | undefined
        notes: string | undefined
        shared: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Roles: {
      Row: {
        id: string
        key: string
        name: string
        description: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        key: string
        name: string
        description: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        key: string | undefined
        name: string | undefined
        description: string | undefined
        created_at: string | undefined
      }
    }
    SaleExpectedInstallments: {
      Row: {
        id: string
        sale_id: string
        installment_number: number
        due_date: string | null
        expected_gross_amount: number | string
        expected_commissionable_amount: number | string
        status: string
        created_at: string
        updated_at: string
        flagged_delinquent: boolean
        reminder_count: number
        last_reminder_at: string | null
        tenant_id: string
        is_monitoring: boolean
      }
      Insert: {
        id: string | undefined
        sale_id: string
        installment_number: number
        due_date: string | null | undefined
        expected_gross_amount: number | string
        expected_commissionable_amount: number | string
        status: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        flagged_delinquent: boolean | undefined
        reminder_count: number | undefined
        last_reminder_at: string | null | undefined
        tenant_id: string
        is_monitoring: boolean | undefined
      }
      Update: {
        id: string | undefined
        sale_id: string | undefined
        installment_number: number | undefined
        due_date: string | undefined
        expected_gross_amount: number | string | undefined
        expected_commissionable_amount: number | string | undefined
        status: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        flagged_delinquent: boolean | undefined
        reminder_count: number | undefined
        last_reminder_at: string | undefined
        tenant_id: string | undefined
        is_monitoring: boolean | undefined
      }
    }
    Sales: {
      Row: {
        id: string
        contact_id: string
        appointment_id: string | null
        product_id: string
        payment_plan_id: string
        sale_date: string
        refund_deadline_at: string
        gross_amount: number | string
        expected_commissionable_amount: number | string | null
        setter_id: string | null
        closer_id: string | null
        affiliate_id: string | null
        affiliate_commission_percent: number | string | null
        status: string
        created_by: string
        updated_by: string | null
        notes: string | null
        created_at: string
        updated_at: string
        cash_day1: number | string | null
        is_upsell: boolean
        origin_sale_id: string | null
        from_follow_up: boolean
        discount: number | string
        processing_fee: number | string
        onboarding_date: string | null
        first_coaching_date: string | null
        graduation_date: string | null
        reservation_amount: number | string
        converted_from_reservation_id: string | null
        down_payment_amount: number | string
        installments_start_date: string | null
        installments_count: number | null
        reservation_completed_at: string | null
        payment_method: string | null
        payment_proof_url: string | null
        custom_plan: Json | null
        extras: string[] | null
        buyer_is_scheduler: boolean
        payer_data: Json | null
        access_email: string | null
        onboarding_scheduled_at: string | null
        onboarding_session_at: string | null
        documents_verified: boolean
        documents_verified_at: string | null
        documents_verified_by: string | null
        documents_verified_override: boolean
        documents_override_reason: string | null
        documents_override_by: string | null
        documents_override_at: string | null
        course_access_granted_at: string | null
        course_access_revoked_at: string | null
        student_document_type: string | null
        student_document_number: string | null
        tenant_id: string
        payment_proof_path: string | null
      }
      Insert: {
        id: string | undefined
        contact_id: string
        appointment_id: string | null | undefined
        product_id: string
        payment_plan_id: string
        sale_date: string
        refund_deadline_at: string
        gross_amount: number | string
        expected_commissionable_amount: number | string | null | undefined
        setter_id: string | null | undefined
        closer_id: string | null | undefined
        affiliate_id: string | null | undefined
        affiliate_commission_percent: number | string | null | undefined
        status: string | undefined
        created_by: string
        updated_by: string | null | undefined
        notes: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        cash_day1: number | string | null | undefined
        is_upsell: boolean | undefined
        origin_sale_id: string | null | undefined
        from_follow_up: boolean | undefined
        discount: number | string | undefined
        processing_fee: number | string | undefined
        onboarding_date: string | null | undefined
        first_coaching_date: string | null | undefined
        graduation_date: string | null | undefined
        reservation_amount: number | string | undefined
        converted_from_reservation_id: string | null | undefined
        down_payment_amount: number | string | undefined
        installments_start_date: string | null | undefined
        installments_count: number | null | undefined
        reservation_completed_at: string | null | undefined
        payment_method: string | null | undefined
        payment_proof_url: string | null | undefined
        custom_plan: Json | null | undefined
        extras: string[] | null | undefined
        buyer_is_scheduler: boolean | undefined
        payer_data: Json | null | undefined
        access_email: string | null | undefined
        onboarding_scheduled_at: string | null | undefined
        onboarding_session_at: string | null | undefined
        documents_verified: boolean | undefined
        documents_verified_at: string | null | undefined
        documents_verified_by: string | null | undefined
        documents_verified_override: boolean | undefined
        documents_override_reason: string | null | undefined
        documents_override_by: string | null | undefined
        documents_override_at: string | null | undefined
        course_access_granted_at: string | null | undefined
        course_access_revoked_at: string | null | undefined
        student_document_type: string | null | undefined
        student_document_number: string | null | undefined
        tenant_id: string
        payment_proof_path: string | null | undefined
      }
      Update: {
        id: string | undefined
        contact_id: string | undefined
        appointment_id: string | undefined
        product_id: string | undefined
        payment_plan_id: string | undefined
        sale_date: string | undefined
        refund_deadline_at: string | undefined
        gross_amount: number | string | undefined
        expected_commissionable_amount: number | string | undefined
        setter_id: string | undefined
        closer_id: string | undefined
        affiliate_id: string | undefined
        affiliate_commission_percent: number | string | undefined
        status: string | undefined
        created_by: string | undefined
        updated_by: string | undefined
        notes: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        cash_day1: number | string | undefined
        is_upsell: boolean | undefined
        origin_sale_id: string | undefined
        from_follow_up: boolean | undefined
        discount: number | string | undefined
        processing_fee: number | string | undefined
        onboarding_date: string | undefined
        first_coaching_date: string | undefined
        graduation_date: string | undefined
        reservation_amount: number | string | undefined
        converted_from_reservation_id: string | undefined
        down_payment_amount: number | string | undefined
        installments_start_date: string | undefined
        installments_count: number | undefined
        reservation_completed_at: string | undefined
        payment_method: string | undefined
        payment_proof_url: string | undefined
        custom_plan: Json | undefined
        extras: string[] | undefined
        buyer_is_scheduler: boolean | undefined
        payer_data: Json | undefined
        access_email: string | undefined
        onboarding_scheduled_at: string | undefined
        onboarding_session_at: string | undefined
        documents_verified: boolean | undefined
        documents_verified_at: string | undefined
        documents_verified_by: string | undefined
        documents_verified_override: boolean | undefined
        documents_override_reason: string | undefined
        documents_override_by: string | undefined
        documents_override_at: string | undefined
        course_access_granted_at: string | undefined
        course_access_revoked_at: string | undefined
        student_document_type: string | undefined
        student_document_number: string | undefined
        tenant_id: string | undefined
        payment_proof_path: string | undefined
      }
    }
    SalesTramos: {
      Row: {
        id: string
        name: string
        threshold: number | string
        emoji: string | null
        color: string | null
        reward: string | null
        sort_order: number
        is_active: boolean
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        threshold: number | string
        emoji: string | null | undefined
        color: string | null | undefined
        reward: string | null | undefined
        sort_order: number | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        threshold: number | string | undefined
        emoji: string | undefined
        color: string | undefined
        reward: string | undefined
        sort_order: number | undefined
        is_active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SalesTramosConfig: {
      Row: {
        id: number
        metric: string
        period: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: number | undefined
        metric: string | undefined
        period: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: number | undefined
        metric: string | undefined
        period: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SavedDashboardViews: {
      Row: {
        id: string
        user_id: string
        name: string
        scope: string
        filters: Json
        widgets: Json
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        user_id: string
        name: string
        scope: string | undefined
        filters: Json
        widgets: Json
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        name: string | undefined
        scope: string | undefined
        filters: Json | undefined
        widgets: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SequraDelinquentCustomers: {
      Row: {
        id: string
        order_reference: string
        merchant_reference: string
        customer_name: string | null
        customer_email: string | null
        product_name: string | null
        order_value: number | string | null
        debt_amount: number | string | null
        overdue_days: number | null
        overdue_since: string | null
        status: string
        notes: string | null
        last_synced_at: string
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        order_reference: string
        merchant_reference: string | undefined
        customer_name: string | null | undefined
        customer_email: string | null | undefined
        product_name: string | null | undefined
        order_value: number | string | null | undefined
        debt_amount: number | string | null | undefined
        overdue_days: number | null | undefined
        overdue_since: string | null | undefined
        status: string | undefined
        notes: string | null | undefined
        last_synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        order_reference: string | undefined
        merchant_reference: string | undefined
        customer_name: string | undefined
        customer_email: string | undefined
        product_name: string | undefined
        order_value: number | string | undefined
        debt_amount: number | string | undefined
        overdue_days: number | undefined
        overdue_since: string | undefined
        status: string | undefined
        notes: string | undefined
        last_synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    SocialPostMetricSnapshots: {
      Row: {
        id: string
        tenant_id: string
        post_id: string
        observed_at: string
        views_count: number | string | null
        likes_count: number | string | null
        comments_count: number | string | null
        shares_count: number | string | null
        source: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        post_id: string
        observed_at: string | undefined
        views_count: number | string | null | undefined
        likes_count: number | string | null | undefined
        comments_count: number | string | null | undefined
        shares_count: number | string | null | undefined
        source: string | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        post_id: string | undefined
        observed_at: string | undefined
        views_count: number | string | undefined
        likes_count: number | string | undefined
        comments_count: number | string | undefined
        shares_count: number | string | undefined
        source: string | undefined
        created_at: string | undefined
      }
    }
    SocialPosts: {
      Row: {
        id: string
        tenant_id: string
        platform: string
        external_id: string
        profile_id: string | null
        content_type: string | null
        caption: string | null
        post_url: string | null
        media_url: string | null
        thumbnail_url: string | null
        published_at: string | null
        views_count: number | string | null
        likes_count: number | string | null
        comments_count: number | string | null
        shares_count: number | string | null
        duration_seconds: number | string | null
        metadata_json: Json | null
        collected_at: string
        source: string
        job_id: string | null
        transcript: string | null
        transcript_timing: string | null
        analysis_status: string
        analysis_json: Json | null
        analyzed_at: string | null
        metrics_observed_at: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        platform: string
        external_id: string
        profile_id: string | null | undefined
        content_type: string | null | undefined
        caption: string | null | undefined
        post_url: string | null | undefined
        media_url: string | null | undefined
        thumbnail_url: string | null | undefined
        published_at: string | null | undefined
        views_count: number | string | null | undefined
        likes_count: number | string | null | undefined
        comments_count: number | string | null | undefined
        shares_count: number | string | null | undefined
        duration_seconds: number | string | null | undefined
        metadata_json: Json | null | undefined
        collected_at: string | undefined
        source: string | undefined
        job_id: string | null | undefined
        transcript: string | null | undefined
        transcript_timing: string | null | undefined
        analysis_status: string | undefined
        analysis_json: Json | null | undefined
        analyzed_at: string | null | undefined
        metrics_observed_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        platform: string | undefined
        external_id: string | undefined
        profile_id: string | undefined
        content_type: string | undefined
        caption: string | undefined
        post_url: string | undefined
        media_url: string | undefined
        thumbnail_url: string | undefined
        published_at: string | undefined
        views_count: number | string | undefined
        likes_count: number | string | undefined
        comments_count: number | string | undefined
        shares_count: number | string | undefined
        duration_seconds: number | string | undefined
        metadata_json: Json | undefined
        collected_at: string | undefined
        source: string | undefined
        job_id: string | undefined
        transcript: string | undefined
        transcript_timing: string | undefined
        analysis_status: string | undefined
        analysis_json: Json | undefined
        analyzed_at: string | undefined
        metrics_observed_at: string | undefined
      }
    }
    SocialProfiles: {
      Row: {
        id: string
        tenant_id: string
        platform: string
        external_id: string | null
        username: string
        display_name: string | null
        profile_url: string | null
        avatar_url: string | null
        followers_count: number | string | null
        following_count: number | string | null
        posts_count: number | string | null
        verified: boolean
        biography: string | null
        metadata_json: Json | null
        collected_at: string
        source: string
        job_id: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        platform: string
        external_id: string | null | undefined
        username: string
        display_name: string | null | undefined
        profile_url: string | null | undefined
        avatar_url: string | null | undefined
        followers_count: number | string | null | undefined
        following_count: number | string | null | undefined
        posts_count: number | string | null | undefined
        verified: boolean | undefined
        biography: string | null | undefined
        metadata_json: Json | null | undefined
        collected_at: string | undefined
        source: string | undefined
        job_id: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        platform: string | undefined
        external_id: string | undefined
        username: string | undefined
        display_name: string | undefined
        profile_url: string | undefined
        avatar_url: string | undefined
        followers_count: number | string | undefined
        following_count: number | string | undefined
        posts_count: number | string | undefined
        verified: boolean | undefined
        biography: string | undefined
        metadata_json: Json | undefined
        collected_at: string | undefined
        source: string | undefined
        job_id: string | undefined
      }
    }
    SocialRawPayloads: {
      Row: {
        id: string
        tenant_id: string
        job_id: string
        payload: Json
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        job_id: string
        payload: Json
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        job_id: string | undefined
        payload: Json | undefined
        created_at: string | undefined
      }
    }
    SocialResearchJobs: {
      Row: {
        id: string
        tenant_id: string
        platform: string
        provider: string
        job_type: string
        actor_id: string | null
        provider_run_id: string | null
        provider_dataset_id: string | null
        status: string
        input_json: Json | null
        idempotency_key: string | null
        records_processed: number
        error_message: string | null
        created_at: string
        started_at: string | null
        completed_at: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        platform: string
        provider: string | undefined
        job_type: string
        actor_id: string | null | undefined
        provider_run_id: string | null | undefined
        provider_dataset_id: string | null | undefined
        status: string | undefined
        input_json: Json | null | undefined
        idempotency_key: string | null | undefined
        records_processed: number | undefined
        error_message: string | null | undefined
        created_at: string | undefined
        started_at: string | null | undefined
        completed_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        platform: string | undefined
        provider: string | undefined
        job_type: string | undefined
        actor_id: string | undefined
        provider_run_id: string | undefined
        provider_dataset_id: string | undefined
        status: string | undefined
        input_json: Json | undefined
        idempotency_key: string | undefined
        records_processed: number | undefined
        error_message: string | undefined
        created_at: string | undefined
        started_at: string | undefined
        completed_at: string | undefined
      }
    }
    StripeCustomers: {
      Row: {
        id: string
        tenant_id: string
        contact_id: string | null
        stripe_customer_id: string
        email: string | null
        name: string | null
        status: string
        subscription_id: string | null
        current_period_end: string | null
        last_synced_at: string
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        contact_id: string | null | undefined
        stripe_customer_id: string
        email: string | null | undefined
        name: string | null | undefined
        status: string
        subscription_id: string | null | undefined
        current_period_end: string | null | undefined
        last_synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        contact_id: string | undefined
        stripe_customer_id: string | undefined
        email: string | undefined
        name: string | undefined
        status: string | undefined
        subscription_id: string | undefined
        current_period_end: string | undefined
        last_synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    StripePayments: {
      Row: {
        id: string
        tenant_id: string
        payment_id: string
        charge_id: string | null
        customer_id: string | null
        customer_email: string | null
        amount: number | string
        refunded_amount: number | string
        currency: string
        status: string
        paid_at: string | null
        metadata: Json | null
        synced_at: string
        created_at: string
        updated_at: string
        stripe_fee: number | string | null
        refunded_at: string | null
        fx_rate_to_eur: number | string | null
        fx_rate_date: string | null
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        payment_id: string
        charge_id: string | null | undefined
        customer_id: string | null | undefined
        customer_email: string | null | undefined
        amount: number | string
        refunded_amount: number | string | undefined
        currency: string | undefined
        status: string | undefined
        paid_at: string | null | undefined
        metadata: Json | null | undefined
        synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        stripe_fee: number | string | null | undefined
        refunded_at: string | null | undefined
        fx_rate_to_eur: number | string | null | undefined
        fx_rate_date: string | null | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        payment_id: string | undefined
        charge_id: string | undefined
        customer_id: string | undefined
        customer_email: string | undefined
        amount: number | string | undefined
        refunded_amount: number | string | undefined
        currency: string | undefined
        status: string | undefined
        paid_at: string | undefined
        metadata: Json | undefined
        synced_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        stripe_fee: number | string | undefined
        refunded_at: string | undefined
        fx_rate_to_eur: number | string | undefined
        fx_rate_date: string | undefined
      }
    }
    StripePriceMap: {
      Row: {
        id: string
        tenant_id: string
        stripe_price_id: string
        product_id: string
        payment_plan_id: string
        created_by: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        stripe_price_id: string
        product_id: string
        payment_plan_id: string
        created_by: string
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        stripe_price_id: string | undefined
        product_id: string | undefined
        payment_plan_id: string | undefined
        created_by: string | undefined
        created_at: string | undefined
      }
    }
    Suggestions: {
      Row: {
        id: string
        user_id: string | null
        type: string
        title: string
        message: string
        status: string
        admin_notes: string | null
        page_url: string | null
        created_at: string
        updated_at: string
        resolved_at: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        user_id: string | null | undefined
        type: string | undefined
        title: string
        message: string
        status: string | undefined
        admin_notes: string | null | undefined
        page_url: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        resolved_at: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        user_id: string | undefined
        type: string | undefined
        title: string | undefined
        message: string | undefined
        status: string | undefined
        admin_notes: string | undefined
        page_url: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        resolved_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Targets: {
      Row: {
        id: string
        name: string
        scope_type: string
        scope_user_id: string | null
        scope_role_key: string | null
        metric_key: string
        period_type: string
        period_start: string
        period_end: string
        target_value: number | string
        is_active: boolean
        created_by: string
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        name: string
        scope_type: string
        scope_user_id: string | null | undefined
        scope_role_key: string | null | undefined
        metric_key: string
        period_type: string
        period_start: string
        period_end: string
        target_value: number | string
        is_active: boolean | undefined
        created_by: string
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        name: string | undefined
        scope_type: string | undefined
        scope_user_id: string | undefined
        scope_role_key: string | undefined
        metric_key: string | undefined
        period_type: string | undefined
        period_start: string | undefined
        period_end: string | undefined
        target_value: number | string | undefined
        is_active: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    Tasks: {
      Row: {
        id: string
        title: string
        description: string | null
        assignee_id: string | null
        status: string
        stage: string | null
        notes: string | null
        due_date: string | null
        source: string
        is_proposal: boolean
        created_by: string | null
        created_at: string
        updated_at: string
        priority: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        title: string
        description: string | null | undefined
        assignee_id: string | null | undefined
        status: string | undefined
        stage: string | null | undefined
        notes: string | null | undefined
        due_date: string | null | undefined
        source: string | undefined
        is_proposal: boolean | undefined
        created_by: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        priority: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        title: string | undefined
        description: string | undefined
        assignee_id: string | undefined
        status: string | undefined
        stage: string | undefined
        notes: string | undefined
        due_date: string | undefined
        source: string | undefined
        is_proposal: boolean | undefined
        created_by: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        priority: string | undefined
        tenant_id: string | undefined
      }
    }
    TenantEmailSettings: {
      Row: {
        id: string
        tenant_id: string
        from_name: string | null
        from_email: string | null
        reply_to_email: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        from_name: string | null | undefined
        from_email: string | null | undefined
        reply_to_email: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        from_name: string | undefined
        from_email: string | undefined
        reply_to_email: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    TenantMembers: {
      Row: {
        id: string
        tenant_id: string
        user_id: string
        role: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        user_id: string
        role: string
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        role: string | undefined
        created_at: string | undefined
      }
    }
    Tenants: {
      Row: {
        id: string
        slug: string
        name: string
        status: string
        settings: Json
        created_at: string
      }
      Insert: {
        id: string | undefined
        slug: string
        name: string
        status: string | undefined
        settings: Json
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        name: string | undefined
        status: string | undefined
        settings: Json | undefined
        created_at: string | undefined
      }
    }
    Testimonios: {
      Row: {
        id: string
        slug: string
        name: string
        kind: string
        avatar: string | null
        sector: string | null
        photo_url: string | null
        youtube_url: string | null
        hook: string | null
        punto_a: string | null
        punto_b: string | null
        vehiculo: string | null
        cifra: string | null
        has_revenue: boolean
        consent: boolean
        sort_order: number
        active: boolean
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        slug: string
        name: string
        kind: string | undefined
        avatar: string | null | undefined
        sector: string | null | undefined
        photo_url: string | null | undefined
        youtube_url: string | null | undefined
        hook: string | null | undefined
        punto_a: string | null | undefined
        punto_b: string | null | undefined
        vehiculo: string | null | undefined
        cifra: string | null | undefined
        has_revenue: boolean | undefined
        consent: boolean | undefined
        sort_order: number | undefined
        active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        name: string | undefined
        kind: string | undefined
        avatar: string | undefined
        sector: string | undefined
        photo_url: string | undefined
        youtube_url: string | undefined
        hook: string | undefined
        punto_a: string | undefined
        punto_b: string | undefined
        vehiculo: string | undefined
        cifra: string | undefined
        has_revenue: boolean | undefined
        consent: boolean | undefined
        sort_order: number | undefined
        active: boolean | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    TrackingSites: {
      Row: {
        id: string
        tenant_id: string
        slug: string
        name: string
        public_key: string
        allowed_origins: string[]
        allow_localhost: boolean
        tracking_enabled: boolean
        consent_default: string
        rate_limit_per_minute: number
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        slug: string
        name: string
        public_key: string
        allowed_origins: string[]
        allow_localhost: boolean | undefined
        tracking_enabled: boolean | undefined
        consent_default: string | undefined
        rate_limit_per_minute: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        slug: string | undefined
        name: string | undefined
        public_key: string | undefined
        allowed_origins: string[] | undefined
        allow_localhost: boolean | undefined
        tracking_enabled: boolean | undefined
        consent_default: string | undefined
        rate_limit_per_minute: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    UserFathomConnections: {
      Row: {
        id: string
        tenant_id: string
        user_id: string
        api_key: string
        key_fingerprint: string | null
        status: string
        last_sync_at: string | null
        last_error: string | null
        meetings_seen: number
        created_at: string
        updated_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        user_id: string
        api_key: string
        key_fingerprint: string | null | undefined
        status: string | undefined
        last_sync_at: string | null | undefined
        last_error: string | null | undefined
        meetings_seen: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        user_id: string | undefined
        api_key: string | undefined
        key_fingerprint: string | undefined
        status: string | undefined
        last_sync_at: string | undefined
        last_error: string | undefined
        meetings_seen: number | undefined
        created_at: string | undefined
        updated_at: string | undefined
      }
    }
    Users: {
      Row: {
        id: string
        full_name: string
        email: string
        phone: string | null
        role_id: string
        is_active: boolean
        default_affiliate_commission_percent: number | string | null
        avatar_url: string | null
        created_at: string
        updated_at: string
        data_scope: string
        start_date: string | null
        base_salary: number | string | null
        commission_percent: number | string | null
        monthly_goal: number | string | null
        assigned_channel: string | null
        member_status: string
        affiliate_code: string | null
        dept_overrides: string[] | null
        tracking_code: string | null
        dni: string | null
        address: string | null
        personal_email: string | null
        calendly_email: string | null
        page_overrides: string[] | null
        fijo_min_sales: number
        fijo_unlock_type: string
        fijo_min_revenue: number | string
        pays_commissions: boolean
      }
      Insert: {
        id: string
        full_name: string
        email: string
        phone: string | null | undefined
        role_id: string
        is_active: boolean | undefined
        default_affiliate_commission_percent: number | string | null | undefined
        avatar_url: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        data_scope: string | undefined
        start_date: string | null | undefined
        base_salary: number | string | null | undefined
        commission_percent: number | string | null | undefined
        monthly_goal: number | string | null | undefined
        assigned_channel: string | null | undefined
        member_status: string | undefined
        affiliate_code: string | null | undefined
        dept_overrides: string[] | null | undefined
        tracking_code: string | null | undefined
        dni: string | null | undefined
        address: string | null | undefined
        personal_email: string | null | undefined
        calendly_email: string | null | undefined
        page_overrides: string[] | null | undefined
        fijo_min_sales: number | undefined
        fijo_unlock_type: string | undefined
        fijo_min_revenue: number | string | undefined
        pays_commissions: boolean | undefined
      }
      Update: {
        id: string | undefined
        full_name: string | undefined
        email: string | undefined
        phone: string | undefined
        role_id: string | undefined
        is_active: boolean | undefined
        default_affiliate_commission_percent: number | string | undefined
        avatar_url: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        data_scope: string | undefined
        start_date: string | undefined
        base_salary: number | string | undefined
        commission_percent: number | string | undefined
        monthly_goal: number | string | undefined
        assigned_channel: string | undefined
        member_status: string | undefined
        affiliate_code: string | undefined
        dept_overrides: string[] | undefined
        tracking_code: string | undefined
        dni: string | undefined
        address: string | undefined
        personal_email: string | undefined
        calendly_email: string | undefined
        page_overrides: string[] | undefined
        fijo_min_sales: number | undefined
        fijo_unlock_type: string | undefined
        fijo_min_revenue: number | string | undefined
        pays_commissions: boolean | undefined
      }
    }
    VslEmbedLocations: {
      Row: {
        id: string
        tenant_id: string
        video_id: string
        video_version_id: string
        normalized_url: string
        domain: string
        placement: string
        first_seen_at: string
        last_seen_at: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        video_id: string
        video_version_id: string
        normalized_url: string
        domain: string
        placement: string | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        video_id: string | undefined
        video_version_id: string | undefined
        normalized_url: string | undefined
        domain: string | undefined
        placement: string | undefined
        first_seen_at: string | undefined
        last_seen_at: string | undefined
        created_at: string | undefined
      }
    }
    VslPlaybackSessions: {
      Row: {
        id: string
        tenant_id: string
        video_id: string
        video_version_id: string
        embed_location_id: string | null
        legacy_session_id: string | null
        viewer_id: string
        session_id: string
        playback_id: string
        started_at: string
        ended_at: string | null
        last_event_at: string | null
        tracking_schema_version: number
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        video_id: string
        video_version_id: string
        embed_location_id: string | null | undefined
        legacy_session_id: string | null | undefined
        viewer_id: string
        session_id: string | undefined
        playback_id: string | undefined
        started_at: string
        ended_at: string | null | undefined
        last_event_at: string | null | undefined
        tracking_schema_version: number | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        video_id: string | undefined
        video_version_id: string | undefined
        embed_location_id: string | undefined
        legacy_session_id: string | undefined
        viewer_id: string | undefined
        session_id: string | undefined
        playback_id: string | undefined
        started_at: string | undefined
        ended_at: string | undefined
        last_event_at: string | undefined
        tracking_schema_version: number | undefined
        created_at: string | undefined
      }
    }
    VslSessions: {
      Row: {
        id: string
        video_id: string
        anon_id: string
        lead_email: string | null
        lead_name: string | null
        referrer: string | null
        device: string | null
        country: string | null
        user_agent: string | null
        duration: number | string
        max_position: number | string
        watched_seconds: number[]
        plays: number
        reached_end: boolean
        first_play_at: string | null
        last_beat_at: string | null
        created_at: string
        updated_at: string
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        video_id: string
        anon_id: string
        lead_email: string | null | undefined
        lead_name: string | null | undefined
        referrer: string | null | undefined
        device: string | null | undefined
        country: string | null | undefined
        user_agent: string | null | undefined
        duration: number | string | undefined
        max_position: number | string | undefined
        watched_seconds: number[]
        plays: number | undefined
        reached_end: boolean | undefined
        first_play_at: string | null | undefined
        last_beat_at: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        video_id: string | undefined
        anon_id: string | undefined
        lead_email: string | undefined
        lead_name: string | undefined
        referrer: string | undefined
        device: string | undefined
        country: string | undefined
        user_agent: string | undefined
        duration: number | string | undefined
        max_position: number | string | undefined
        watched_seconds: number[] | undefined
        plays: number | undefined
        reached_end: boolean | undefined
        first_play_at: string | undefined
        last_beat_at: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
      }
    }
    VslTrackingEvents: {
      Row: {
        id: string
        tenant_id: string
        playback_id: string
        event_id: string
        event_type: string
        occurred_at: string
        received_at: string
        playhead_seconds: number | string | null
        duration_seconds: number | string | null
        playback_rate: number | string | null
        visibility_state: string | null
        source: string
        schema_version: number
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        playback_id: string
        event_id: string
        event_type: string
        occurred_at: string
        received_at: string | undefined
        playhead_seconds: number | string | null | undefined
        duration_seconds: number | string | null | undefined
        playback_rate: number | string | null | undefined
        visibility_state: string | null | undefined
        source: string | undefined
        schema_version: number | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        playback_id: string | undefined
        event_id: string | undefined
        event_type: string | undefined
        occurred_at: string | undefined
        received_at: string | undefined
        playhead_seconds: number | string | undefined
        duration_seconds: number | string | undefined
        playback_rate: number | string | undefined
        visibility_state: string | undefined
        source: string | undefined
        schema_version: number | undefined
        created_at: string | undefined
      }
    }
    VslVideoVersions: {
      Row: {
        id: string
        tenant_id: string
        video_id: string
        version_number: number
        provider: string
        provider_video_id: string | null
        source_url: string | null
        duration_seconds: number | string
        published_at: string
        replaced_at: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        video_id: string
        version_number: number
        provider: string | undefined
        provider_video_id: string | null | undefined
        source_url: string | null | undefined
        duration_seconds: number | string | undefined
        published_at: string | undefined
        replaced_at: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        video_id: string | undefined
        version_number: number | undefined
        provider: string | undefined
        provider_video_id: string | undefined
        source_url: string | undefined
        duration_seconds: number | string | undefined
        published_at: string | undefined
        replaced_at: string | undefined
        created_at: string | undefined
      }
    }
    VslVideos: {
      Row: {
        id: string
        slug: string
        name: string
        source_url: string | null
        poster_url: string | null
        duration_seconds: number | string
        config: Json
        created_at: string
        updated_at: string
        tenant_id: string
        deleted_at: string | null
      }
      Insert: {
        id: string | undefined
        slug: string
        name: string
        source_url: string | null | undefined
        poster_url: string | null | undefined
        duration_seconds: number | string | undefined
        config: Json
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string
        deleted_at: string | null | undefined
      }
      Update: {
        id: string | undefined
        slug: string | undefined
        name: string | undefined
        source_url: string | undefined
        poster_url: string | undefined
        duration_seconds: number | string | undefined
        config: Json | undefined
        created_at: string | undefined
        updated_at: string | undefined
        tenant_id: string | undefined
        deleted_at: string | undefined
      }
    }
    VslViewerIdentities: {
      Row: {
        id: string
        tenant_id: string
        viewer_id: string
        contact_id: string
        link_source: string
        linked_at: string
        revoked_at: string | null
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        viewer_id: string
        contact_id: string
        link_source: string
        linked_at: string | undefined
        revoked_at: string | null | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        viewer_id: string | undefined
        contact_id: string | undefined
        link_source: string | undefined
        linked_at: string | undefined
        revoked_at: string | undefined
        created_at: string | undefined
      }
    }
    VslWatchIntervals: {
      Row: {
        id: string
        tenant_id: string
        playback_id: string
        batch_id: string
        sequence_number: number
        start_second: number | string
        end_second: number | string
        playback_rate: number | string
        occurred_at: string
        received_at: string
        created_at: string
      }
      Insert: {
        id: string | undefined
        tenant_id: string
        playback_id: string
        batch_id: string
        sequence_number: number
        start_second: number | string
        end_second: number | string
        playback_rate: number | string | undefined
        occurred_at: string
        received_at: string | undefined
        created_at: string | undefined
      }
      Update: {
        id: string | undefined
        tenant_id: string | undefined
        playback_id: string | undefined
        batch_id: string | undefined
        sequence_number: number | undefined
        start_second: number | string | undefined
        end_second: number | string | undefined
        playback_rate: number | string | undefined
        occurred_at: string | undefined
        received_at: string | undefined
        created_at: string | undefined
      }
    }
    YoutubeUploads: {
      Row: {
        id: string
        ig_media_external_id: string
        youtube_video_id: string | null
        status: string
        error: string | null
        created_at: string
        updated_at: string
        views: number | string
        likes: number | string
        comments: number | string
        stats_synced_at: string | null
        tenant_id: string
      }
      Insert: {
        id: string | undefined
        ig_media_external_id: string
        youtube_video_id: string | null | undefined
        status: string | undefined
        error: string | null | undefined
        created_at: string | undefined
        updated_at: string | undefined
        views: number | string | undefined
        likes: number | string | undefined
        comments: number | string | undefined
        stats_synced_at: string | null | undefined
        tenant_id: string
      }
      Update: {
        id: string | undefined
        ig_media_external_id: string | undefined
        youtube_video_id: string | undefined
        status: string | undefined
        error: string | undefined
        created_at: string | undefined
        updated_at: string | undefined
        views: number | string | undefined
        likes: number | string | undefined
        comments: number | string | undefined
        stats_synced_at: string | undefined
        tenant_id: string | undefined
      }
    }
  }
}
