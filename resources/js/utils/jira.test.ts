import { describe, expect, it } from 'vitest';
import {
    describeInvalidRange,
    describeSkipReason,
    detectIssueKey,
    missingReferenceBadges,
    parseProjectKeys,
    toExternalSyncBadges,
    type MissingReferenceCandidate,
} from './jira';

describe('toExternalSyncBadges', () => {
    it('maps the states that only the server can know', () => {
        const badges = toExternalSyncBadges({
            a: { state: 'synced', issue_key: 'PROJ-1', reason: null },
            b: { state: 'pending', issue_key: 'PROJ-2', reason: null },
            c: { state: 'outdated', issue_key: 'PROJ-3', reason: null },
        });

        expect(badges.a?.state).toBe('synced');
        expect(badges.b?.state).toBe('pending');
        expect(badges.c?.state).toBe('outdated');
    });

    it('puts the ticket in the label, so hovering a dot says which issue', () => {
        const badges = toExternalSyncBadges({
            a: { state: 'synced', issue_key: 'PROJ-1', reason: null },
        });

        expect(badges.a?.label).toContain('PROJ-1');
    });

    it('leaves no_reference to the client side derivation', () => {
        // Taking it from the server is what made a new entry show no dot until a refetch
        const badges = toExternalSyncBadges({
            a: { state: 'no_reference', issue_key: null, reason: null },
        });

        expect(badges).toEqual({});
    });

    it('never marks entries that are not candidates', () => {
        const badges = toExternalSyncBadges({
            a: { state: 'ignored', issue_key: null, reason: 'break' },
            b: { state: 'ignored', issue_key: null, reason: 'still_running' },
            c: { state: 'ignored', issue_key: null, reason: 'before_cutoff' },
        });

        expect(badges).toEqual({});
    });

    it('returns nothing when no statuses have loaded yet', () => {
        expect(toExternalSyncBadges(undefined)).toEqual({});
    });
});

/*
 * The regression these guard: the "no ticket" dot used to come from the server, so a newly
 * created entry had no dot until the status query happened to refetch - in practice not until
 * the page was reloaded. Deriving it from the entries themselves makes it correct immediately,
 * which is only true as long as this stays a pure function of the entry list.
 */
describe('missingReferenceBadges', () => {
    const entry = (over: Partial<MissingReferenceCandidate> = {}): MissingReferenceCandidate => ({
        id: 'entry-1',
        description: 'team standup',
        start: '2026-08-05T09:00:00Z',
        end: '2026-08-05T10:00:00Z',
        type: 'work',
        ...over,
    });

    it('marks a work entry with no ticket', () => {
        const badges = missingReferenceBadges([entry()]);

        expect(badges['entry-1']?.state).toBe('missing-reference');
    });

    it('leaves an entry that has a ticket alone', () => {
        const badges = missingReferenceBadges([entry({ description: 'PROJ-1 fix login' })]);

        expect(badges).toEqual({});
    });

    it('reacts to a description the moment it changes', () => {
        // What the calendar does when an entry is created or edited: recompute from the list
        const withoutKey = entry({ description: 'no ticket' });
        const withKey = entry({ description: 'PROJ-1 now it has one' });

        expect(missingReferenceBadges([withoutKey])['entry-1']?.state).toBe('missing-reference');
        expect(missingReferenceBadges([withKey])['entry-1']).toBeUndefined();
    });

    it('ignores breaks and running entries', () => {
        const badges = missingReferenceBadges([
            entry({ id: 'break', type: 'break' }),
            entry({ id: 'running', end: null }),
        ]);

        expect(badges).toEqual({});
    });

    it('ignores work before the sync cutoff', () => {
        const badges = missingReferenceBadges(
            [
                entry({ id: 'old', start: '2026-08-01T09:00:00Z', end: '2026-08-01T10:00:00Z' }),
                entry({ id: 'new', start: '2026-08-06T09:00:00Z', end: '2026-08-06T10:00:00Z' }),
            ],
            { syncFromDate: '2026-08-05' }
        );

        expect(badges.old).toBeUndefined();
        expect(badges.new?.state).toBe('missing-reference');
    });

    it('honours the project key allow list', () => {
        // Without the allow list "UTF-8" counts as a key, so this entry looks fine
        const utf = [entry({ description: 'fixed UTF-8 handling' })];

        expect(missingReferenceBadges(utf)).toEqual({});
        expect(
            missingReferenceBadges(utf, { allowedProjectKeys: ['PROJ'] })['entry-1']?.state
        ).toBe('missing-reference');
    });

    it('handles an empty list', () => {
        expect(missingReferenceBadges([])).toEqual({});
    });
});

describe('describeSkipReason', () => {
    it('explains why an entry was left out', () => {
        expect(describeSkipReason('before_cutoff')).toContain('already logged');
        expect(describeSkipReason('still_running')).toContain('stopped');
        expect(describeSkipReason('break')).toContain('Breaks');
        expect(describeSkipReason('too_short')).toContain('minute');
    });

    it('falls back to the missing ticket wording for an unknown reason', () => {
        expect(describeSkipReason('something_new')).toContain('No Jira ticket');
    });
});

/*
 * These mirror JiraIssueKeyParserTest on the PHP side. The pattern is duplicated so the edit
 * dialog can show the ticket as you type; if one side changes, these should fail.
 */
describe('detectIssueKey', () => {
    it('finds a key anywhere in the description', () => {
        expect(detectIssueKey('PROJ-123 fixed the login redirect')).toBe('PROJ-123');
        expect(detectIssueKey('looked into PROJ-123 with Sam')).toBe('PROJ-123');
        expect(detectIssueKey('PROJ-123')).toBe('PROJ-123');
    });

    it('returns the first key when several are mentioned', () => {
        expect(detectIssueKey('PROJ-1 blocked by PROJ-2')).toBe('PROJ-1');
    });

    it('returns null when there is no key', () => {
        expect(detectIssueKey('team standup')).toBeNull();
        expect(detectIssueKey('')).toBeNull();
        expect(detectIssueKey(null)).toBeNull();
        expect(detectIssueKey(undefined)).toBeNull();
    });

    it('does not match a lowercase or single letter key', () => {
        expect(detectIssueKey('proj-123 fixed it')).toBeNull();
        expect(detectIssueKey('X-1 fixed it')).toBeNull();
    });

    it('does not treat a longer key as a shorter one', () => {
        expect(detectIssueKey('MYPROJ-12 refactor')).toBe('MYPROJ-12');
    });

    it('matches look-alikes without an allow list, and rejects them with one', () => {
        expect(detectIssueKey('fixed UTF-8 handling')).toBe('UTF-8');
        expect(detectIssueKey('COVID-19 policy update')).toBe('COVID-19');
        expect(detectIssueKey('fixed UTF-8 handling', ['PROJ'])).toBeNull();
    });

    it('skips to the first allowed key', () => {
        expect(detectIssueKey('fixed UTF-8 handling for PROJ-9', ['PROJ'])).toBe('PROJ-9');
    });
});

describe('parseProjectKeys', () => {
    it('accepts commas, whitespace or both, and uppercases', () => {
        expect(parseProjectKeys('PROJ,OPS')).toEqual(['PROJ', 'OPS']);
        expect(parseProjectKeys('proj, ops')).toEqual(['PROJ', 'OPS']);
        expect(parseProjectKeys(' PROJ   OPS ')).toEqual(['PROJ', 'OPS']);
    });

    it('treats empty as no restriction', () => {
        expect(parseProjectKeys('')).toEqual([]);
        expect(parseProjectKeys(null)).toEqual([]);
        expect(parseProjectKeys(undefined)).toEqual([]);
    });
});

/*
 * Mirrors JiraSyncRangeRequest::MAX_RANGE_DAYS. Checked here so the sync dialog's range picker
 * explains itself, rather than the server coming back with a bare 422.
 */
describe('describeInvalidRange', () => {
    it('accepts a range within the limit', () => {
        expect(describeInvalidRange('2026-08-03', '2026-08-09')).toBeNull();
        expect(describeInvalidRange('2026-08-03', '2026-08-03')).toBeNull();
    });

    it('accepts exactly the maximum', () => {
        expect(describeInvalidRange('2026-01-01', '2026-03-04')).toBeNull();
    });

    it('rejects a range longer than the maximum', () => {
        expect(describeInvalidRange('2026-01-01', '2026-03-05')).toContain('62 days');
    });

    it('rejects an end before the start', () => {
        expect(describeInvalidRange('2026-08-09', '2026-08-03')).toContain('end date');
    });

    it('says nothing while the range is half chosen', () => {
        // The picker clears the end as soon as a new start is picked
        expect(describeInvalidRange('2026-08-03', '')).toBeNull();
        expect(describeInvalidRange('', '')).toBeNull();
    });
});
