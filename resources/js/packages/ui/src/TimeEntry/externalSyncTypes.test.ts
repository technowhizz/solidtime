import { describe, expect, it } from 'vitest';
import {
    worstExternalSyncBadge,
    type ExternalSyncBadges,
    type ExternalSyncState,
} from './externalSyncTypes';

function badges(entries: Record<string, ExternalSyncState>): ExternalSyncBadges {
    return Object.fromEntries(
        Object.entries(entries).map(([id, state]) => [id, { state, label: state }])
    );
}

describe('worstExternalSyncBadge', () => {
    it('returns null when nothing is known about the entries', () => {
        expect(worstExternalSyncBadge(['a'], undefined)).toBeNull();
        expect(worstExternalSyncBadge(['a'], {})).toBeNull();
    });

    it('surfaces the entry that most needs attention, not the most common one', () => {
        // A grouped row or a timesheet cell stands for several entries. Three synced and one
        // missing a ticket should read as "something to fix here".
        const result = worstExternalSyncBadge(
            ['a', 'b', 'c', 'd'],
            badges({
                a: 'synced',
                b: 'synced',
                c: 'synced',
                d: 'missing-reference',
            })
        );

        expect(result?.state).toBe('missing-reference');
    });

    it('ranks an error above a missing reference', () => {
        const result = worstExternalSyncBadge(
            ['a', 'b'],
            badges({ a: 'missing-reference', b: 'error' })
        );

        expect(result?.state).toBe('error');
    });

    it('ranks outdated above pending, and pending above synced', () => {
        expect(
            worstExternalSyncBadge(['a', 'b'], badges({ a: 'pending', b: 'outdated' }))?.state
        ).toBe('outdated');
        expect(
            worstExternalSyncBadge(['a', 'b'], badges({ a: 'synced', b: 'pending' }))?.state
        ).toBe('pending');
    });

    it('ignores ids it has no badge for', () => {
        const result = worstExternalSyncBadge(['known', 'unknown'], badges({ known: 'synced' }));

        expect(result?.state).toBe('synced');
    });

    it('reports synced only when every entry is synced', () => {
        const result = worstExternalSyncBadge(['a', 'b'], badges({ a: 'synced', b: 'synced' }));

        expect(result?.state).toBe('synced');
    });
});
