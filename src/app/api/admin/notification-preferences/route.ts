import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import type { EventType, Channel } from '@/lib/notifications/types';
import type { Tables } from '@/lib/supabase/database.types';

type NotificationPreferenceRow = Tables<'notification_preferences'>;

// ============================================================================
// Validation Schemas
// ============================================================================

const EVENT_TYPES: EventType[] = [
  'task_assigned',
  'task_mentioned',
  'status_changed',
  'due_soon',
  'comment_added',
  'project_created',
  'member_invited',
  'task_completed',
];

const CHANNELS: Channel[] = ['email', 'in_app'];

const PreferenceItemSchema = z.object({
  eventType: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  channel: z.enum(CHANNELS as [Channel, ...Channel[]]),
  enabled: z.boolean(),
});

const UpdatePreferencesSchema = z.object({
  preferences: z.array(PreferenceItemSchema).min(1).max(16),
});

// ============================================================================
// Response Types (camelCase)
// ============================================================================

interface PreferenceItem {
  channel: Channel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PreferencesByEvent {
  eventType: EventType;
  preferences: PreferenceItem[];
}

interface PreferencesResponse {
  data: PreferencesByEvent[];
}

// ============================================================================
// GET Handler - Fetch all preferences for authenticated user
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  void request;
  try {
    // Verify authentication with Supabase
    const supabase = await createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authData.user.id;

    // Get user's organization membership
    const { data: membership, error: membershipError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const organizationId = membership.organization_id;

    // Query preferences for this user and organization
    const { data: preferences, error: queryError } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .order('event_type', { ascending: true })
      .order('channel', { ascending: true });

    if (queryError) {
      console.error('Failed to fetch preferences:', queryError);
      return NextResponse.json(
        { error: 'Failed to fetch preferences' },
        { status: 500 }
      );
    }

    // Group preferences by event_type
    const grouped: Record<EventType, PreferencesByEvent> = {} as Record<
      EventType,
      PreferencesByEvent
    >;

    (preferences || []).forEach((pref: NotificationPreferenceRow) => {
      const eventType = pref.event_type as EventType;
      if (!grouped[eventType]) {
        grouped[eventType] = {
          eventType,
          preferences: [],
        };
      }
      grouped[eventType].preferences.push({
        channel: pref.channel as Channel,
        enabled: pref.enabled,
        createdAt: pref.created_at,
        updatedAt: pref.updated_at,
      });
    });

    // Convert to array and sort by event type
    const result: PreferencesByEvent[] = Object.values(grouped).sort(
      (a, b) => EVENT_TYPES.indexOf(a.eventType) - EVENT_TYPES.indexOf(b.eventType)
    );

    const response: PreferencesResponse = { data: result };
    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/admin/notification-preferences error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH Handler - Update user preferences (upsert)
// ============================================================================

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication
    const supabase = await createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authData.user.id;

    // Get user's organization membership
    const { data: membership, error: membershipError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const organizationId = membership.organization_id;

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const parseResult = UpdatePreferencesSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      return NextResponse.json(
        { error: 'Validation error', details: errors },
        { status: 422 }
      );
    }

    const { preferences: preferencesToUpdate } = parseResult.data;

    // Prepare upsert data (snake_case for database)
    const upsertData = preferencesToUpdate.map((pref) => ({
      user_id: userId,
      organization_id: organizationId,
      event_type: pref.eventType,
      channel: pref.channel,
      enabled: pref.enabled,
    }));

    // Upsert preferences using Supabase upsert with onConflict
    const { error: upsertError } = await supabase
      .from('notification_preferences')
      .upsert(upsertData, {
        onConflict: 'user_id,organization_id,event_type,channel',
      })
      .select();

    if (upsertError) {
      console.error('Failed to upsert preferences:', upsertError);
      return NextResponse.json(
        { error: 'Failed to update preferences' },
        { status: 500 }
      );
    }

    // Re-fetch all preferences to return complete set (same as GET response)
    const { data: allPreferences, error: fetchError } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .order('event_type', { ascending: true })
      .order('channel', { ascending: true });

    if (fetchError) {
      console.error('Failed to fetch updated preferences:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch updated preferences' },
        { status: 500 }
      );
    }

    // Group preferences by event_type (same format as GET)
    const grouped: Record<EventType, PreferencesByEvent> = {} as Record<
      EventType,
      PreferencesByEvent
    >;

    (allPreferences || []).forEach((pref: NotificationPreferenceRow) => {
      const eventType = pref.event_type as EventType;
      if (!grouped[eventType]) {
        grouped[eventType] = {
          eventType,
          preferences: [],
        };
      }
      grouped[eventType].preferences.push({
        channel: pref.channel as Channel,
        enabled: pref.enabled,
        createdAt: pref.created_at,
        updatedAt: pref.updated_at,
      });
    });

    const result: PreferencesByEvent[] = Object.values(grouped).sort(
      (a, b) => EVENT_TYPES.indexOf(a.eventType) - EVENT_TYPES.indexOf(b.eventType)
    );

    const response: PreferencesResponse = { data: result };
    return NextResponse.json(response);
  } catch (error) {
    console.error('PATCH /api/admin/notification-preferences error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
