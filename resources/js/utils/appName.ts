import { usePage } from '@inertiajs/vue3';
import { computed, type ComputedRef } from 'vue';

/**
 * The product name, from `config('app.name')` by way of the shared Inertia props.
 *
 * Use this anywhere the app refers to itself in user-facing copy, so renaming it is a single
 * change in config/app.php. Deliberately not used for things that only look like the name:
 * localStorage keys (`solidtime:calendar-settings`), the docs and support URLs, and the
 * `@solidtime-import.test` sentinel are all functional values that must not move with it.
 */
export function useAppName(): ComputedRef<string> {
    const page = usePage<{ app_name?: string }>();

    return computed(() => page.props.app_name ?? 'solidtime');
}
