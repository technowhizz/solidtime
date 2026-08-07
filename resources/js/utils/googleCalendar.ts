import { usePage } from '@inertiajs/vue3';

/**
 * Whether the operator configured a Google OAuth client. Everything user facing gates on
 * this, so a self-hosted installation without one never sees the integration.
 */
export function isGoogleCalendarEnabled(): boolean {
    const page = usePage<{
        google_calendar_enabled: boolean;
    }>();

    return page.props.google_calendar_enabled === true;
}
