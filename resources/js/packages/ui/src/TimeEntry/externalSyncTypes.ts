/**
 * Sync state of a time entry against an external issue tracker.
 *
 * This package stays provider agnostic - it knows nothing about Jira, or about issue keys. The
 * page maps whatever its provider returns onto these states before passing them down, the same
 * way external calendar events are mapped in Calendar.vue.
 */
export type ExternalSyncState =
    /** A work entry with nothing to sync against, ex. no issue key in the description. */
    | 'missing-reference'
    /** Ready to sync, but not sent yet. */
    | 'pending'
    /** Sent, and unchanged since. */
    | 'synced'
    /** Sent, but edited since - the external system is behind. */
    | 'outdated'
    /** The last attempt to sync it failed. */
    | 'error';

export interface ExternalSyncBadge {
    state: ExternalSyncState;
    /** Shown on hover. Written by the page, since only it knows the provider's vocabulary. */
    label: string;
}

/** Keyed by time entry id. */
export type ExternalSyncBadges = Record<string, ExternalSyncBadge>;

/**
 * A reference to an item in an external tracker that a description points at, ex. a Jira issue.
 */
export interface ExternalReference {
    /** Short label to show, ex. "PROJ-123". */
    label: string;
}

/**
 * Detects a reference in a description. Injected by the app rather than imported, so this
 * package can show a Jira ticket without knowing Jira exists - the same way `organization` is
 * injected. Absent injection means the host tracks no external references at all.
 */
export type ExternalReferenceDetector = (
    description: string | null | undefined
) => ExternalReference | null;

export const EXTERNAL_REFERENCE_DETECTOR = 'externalReferenceDetector';

/**
 * Worst first: a row or cell standing in for several entries should surface the one that most
 * needs attention rather than the most common one.
 */
const SEVERITY: Record<ExternalSyncState, number> = {
    error: 4,
    'missing-reference': 3,
    outdated: 2,
    pending: 1,
    synced: 0,
};

/**
 * Collapses the states of several entries into the single badge that represents them - used by
 * the grouped rows in the time list and by timesheet cells, which each stand for a set of
 * entries rather than one.
 */
export function worstExternalSyncBadge(
    timeEntryIds: string[],
    badges: ExternalSyncBadges | undefined
): ExternalSyncBadge | null {
    if (!badges) {
        return null;
    }

    let worst: ExternalSyncBadge | null = null;
    for (const id of timeEntryIds) {
        const badge = badges[id];
        if (badge && (worst === null || SEVERITY[badge.state] > SEVERITY[worst.state])) {
            worst = badge;
        }
    }

    return worst;
}
