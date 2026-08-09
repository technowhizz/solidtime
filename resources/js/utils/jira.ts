import { usePage } from '@inertiajs/vue3';
import { useStorage } from '@vueuse/core';
import type { JiraSyncEntryStatus } from '@/packages/api/src';
import { getLocalizedDayJs } from '@/packages/ui/src/utils/time';
import type {
    ExternalSyncBadge,
    ExternalSyncBadges,
} from '@/packages/ui/src/TimeEntry/externalSyncTypes';

/**
 * Whether an administrator has pointed this organization at a Jira site. Everything user facing
 * gates on this, so an organization that does not use Jira never sees the integration.
 */
export function isJiraEnabled(): boolean {
    const page = usePage<{
        jira_enabled: boolean;
    }>();

    return page.props.jira_enabled === true;
}

/**
 * Whether to mark work entries that carry no Jira issue key. Off by default: on a board where
 * only some work is ticketed it is noise, and it is only useful to the people who want it.
 *
 * Shared by the calendar, the time list and the timesheet, so the setting follows you between
 * them. Same approach as utils/timeEntryGrouping.ts.
 */
export const showMissingTicketHintsSetting = useStorage<boolean>(
    'solidtime:jira-missing-ticket-hints',
    false
);

const STATE_LABELS: Record<string, string> = {
    synced: 'Logged in Jira',
    pending: 'Not logged in Jira yet',
    outdated: 'Changed since it was logged in Jira',
    no_reference: 'No Jira ticket in the description',
};

const REASON_LABELS: Record<string, string> = {
    before_cutoff: 'Before your Jira start date, treated as already logged',
    still_running: 'Still running, it will sync once stopped',
    break: 'Breaks are not logged to Jira',
    too_short: 'Under a minute, which Jira will not accept',
};

/**
 * Maps the server's sync states onto the provider agnostic badges packages/ui renders.
 *
 * Only synced / pending / outdated live here, because only those need the server - it alone
 * knows what has been logged. "No ticket" is deliberately NOT one of them: see
 * missingReferenceBadges below.
 */
export function toExternalSyncBadges(
    statuses: Record<string, JiraSyncEntryStatus> | undefined
): ExternalSyncBadges {
    const badges: ExternalSyncBadges = {};
    if (!statuses) {
        return badges;
    }

    for (const [timeEntryId, status] of Object.entries(statuses)) {
        const label = STATE_LABELS[status.state];
        // no_reference and ignored are both handled client side, from the entry itself
        if (!label || status.state === 'no_reference' || status.state === 'ignored') {
            continue;
        }

        badges[timeEntryId] = {
            state: status.state as ExternalSyncBadge['state'],
            label: status.issue_key ? `${status.issue_key} — ${label}` : label,
        };
    }

    return badges;
}

/** The minimum of a time entry needed to decide whether it is missing a ticket. */
export interface MissingReferenceCandidate {
    id: string;
    description?: string | null;
    start: string;
    end?: string | null;
    type?: string;
}

/**
 * Work entries with no ticket in their description, derived entirely on the client.
 *
 * This used to come from the server, which meant a newly created entry had no dot until the
 * status query happened to refetch - in practice, until the page was reloaded. Nothing here
 * needs the server: the rules mirror JiraWorklogGrouper, and the description is already on
 * screen. Deriving it makes the dot correct the instant the entry list changes, and costs no
 * request at all for someone who has not connected an account.
 */
export function missingReferenceBadges(
    timeEntries: MissingReferenceCandidate[],
    options: { allowedProjectKeys?: string[]; syncFromDate?: string | null } = {}
): ExternalSyncBadges {
    const badges: ExternalSyncBadges = {};

    for (const entry of timeEntries) {
        // Breaks are not work, and a running entry has no final duration yet
        if (entry.type === 'break' || !entry.end) {
            continue;
        }
        // Work before the cutoff is treated as already logged elsewhere
        if (options.syncFromDate) {
            const workDate = getLocalizedDayJs(entry.start).format('YYYY-MM-DD');
            if (workDate < options.syncFromDate) {
                continue;
            }
        }
        if (detectIssueKey(entry.description, options.allowedProjectKeys ?? []) !== null) {
            continue;
        }

        badges[entry.id] = {
            state: 'missing-reference',
            label: STATE_LABELS.no_reference!,
        };
    }

    return badges;
}

/**
 * Jira project keys start with a letter and are at least two characters, then a hyphen and the
 * issue number.
 *
 * Deliberately kept in step with JiraIssueKeyParser::ISSUE_KEY_PATTERN. It is duplicated rather
 * than fetched because the edit dialog shows the detected ticket as you type, and a round trip
 * per keystroke to say something this cheap to compute would be absurd. The server remains the
 * authority: it re-parses at sync time, and this only ever affects what is displayed.
 */
const ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9]+)-\d+\b/g;

/**
 * The ticket a description refers to, or null. First match wins, and an organization's project
 * key allow list narrows it - without one, `UTF-8` and `COVID-19` are the same shape as a key.
 */
export function detectIssueKey(
    description: string | null | undefined,
    allowedProjectKeys: string[] = []
): string | null {
    const text = (description ?? '').trim();
    if (text === '') {
        return null;
    }

    for (const match of text.matchAll(ISSUE_KEY_PATTERN)) {
        if (allowedProjectKeys.length === 0 || allowedProjectKeys.includes(match[1]!)) {
            return match[0];
        }
    }

    return null;
}

/** Parses the organization's comma separated allow list, matching JiraConfig::parseProjectKeys. */
export function parseProjectKeys(value: string | null | undefined): string[] {
    return (value ?? '')
        .split(/[\s,]+/)
        .map((key) => key.trim().toUpperCase())
        .filter((key) => key !== '');
}

/**
 * Longest range a single sync may cover. Mirrors JiraSyncRangeRequest::MAX_RANGE_DAYS - checked
 * here as well so choosing a silly range says so, rather than coming back as a raw 422.
 */
export const MAX_SYNC_RANGE_DAYS = 62;

/** Why a chosen range cannot be synced, or null if it is fine. */
export function describeInvalidRange(startDate: string, endDate: string): string | null {
    if (startDate === '' || endDate === '') {
        return null;
    }
    if (endDate < startDate) {
        return 'The end date must not be before the start date.';
    }

    const days = getLocalizedDayJs(endDate).diff(getLocalizedDayJs(startDate), 'day');
    if (days > MAX_SYNC_RANGE_DAYS) {
        return `A single sync can cover at most ${MAX_SYNC_RANGE_DAYS} days.`;
    }

    return null;
}

/** Human readable form of a skip reason, for the preview dialog's skipped list. */
export function describeSkipReason(reason: string): string {
    return REASON_LABELS[reason] ?? 'No Jira ticket in the description';
}
