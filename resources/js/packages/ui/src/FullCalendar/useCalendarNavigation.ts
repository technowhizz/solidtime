import { computed, ref, watch } from 'vue';
import type { Dayjs } from 'dayjs';
import { getLocalizedDayJs } from '../utils/time';
import { getCalendarWeekDays, getWeekStartDayNumber } from '../utils/settings';

export function useCalendarNavigation(callbacks: {
    onDatesChange: (payload: { start: Dayjs; end: Dayjs }) => void;
    scrollToCurrentTime: () => void;
    initialDate?: Dayjs | null;
}) {
    function getFirstDay(): number {
        return getWeekStartDayNumber();
    }

    /**
     * True when the week view would not render a column for this date, which happens
     * once the user shows fewer than 7 days. Deep links (?date=) can point at any day
     * of the week, so they need to fall back to the day view.
     */
    function isHiddenInWeekView(date: Dayjs): boolean {
        const offset = (date.day() - getFirstDay() + 7) % 7;
        return offset >= getCalendarWeekDays();
    }

    const activeView = ref(
        callbacks.initialDate && isHiddenInWeekView(callbacks.initialDate)
            ? 'timeGridDay'
            : 'timeGridWeek'
    );
    const currentDate = ref(callbacks.initialDate ?? getLocalizedDayJs());

    const viewDays = computed<Dayjs[]>(() => {
        const numDays = activeView.value === 'timeGridWeek' ? getCalendarWeekDays() : 1;

        if (numDays === 1) {
            return [currentDate.value.startOf('day')];
        }

        const firstDay = getFirstDay();
        const today = currentDate.value.startOf('day');
        const offset = (today.day() - firstDay + 7) % 7;
        const weekStart = today.subtract(offset, 'day');

        const days: Dayjs[] = [];
        for (let i = 0; i < numDays; i++) {
            days.push(weekStart.add(i, 'day'));
        }
        return days;
    });

    const viewTitle = computed(() => {
        if (activeView.value === 'timeGridDay') {
            return currentDate.value.format('MMMM YYYY');
        }

        const days = viewDays.value;
        if (days.length === 0) return '';

        const first = days[0]!;
        const last = days[days.length - 1]!;

        if (first.year() !== last.year()) {
            return `${first.format('MMM YYYY')} \u2013 ${last.format('MMM YYYY')}`;
        }
        if (first.month() !== last.month()) {
            return `${first.format('MMM')} \u2013 ${last.format('MMM YYYY')}`;
        }
        return first.format('MMMM YYYY');
    });

    function emitDatesChange() {
        const days = viewDays.value;
        if (days.length === 0) return;

        const start = days[0]!;
        const end = days[days.length - 1]!.add(1, 'day');
        callbacks.onDatesChange({ start, end });
    }

    // The rendered window can change without a navigation click, because the day count
    // is a user preference read reactively off the shared page props. Without this the
    // grid would resize while the fetched range stayed put, so the loaded time entries
    // would no longer line up with the visible columns.
    watch(viewDays, () => {
        emitDatesChange();
    });

    function handlePrev() {
        if (activeView.value === 'timeGridWeek') {
            currentDate.value = currentDate.value.subtract(7, 'day');
        } else {
            currentDate.value = currentDate.value.subtract(1, 'day');
        }
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    function handleNext() {
        if (activeView.value === 'timeGridWeek') {
            currentDate.value = currentDate.value.add(7, 'day');
        } else {
            currentDate.value = currentDate.value.add(1, 'day');
        }
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    function handleToday() {
        currentDate.value = getLocalizedDayJs();
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    function handleChangeView(view: string) {
        activeView.value = view;
        emitDatesChange();
        callbacks.scrollToCurrentTime();
    }

    return {
        activeView,
        currentDate,
        viewDays,
        viewTitle,
        emitDatesChange,
        handlePrev,
        handleNext,
        handleToday,
        handleChangeView,
    };
}
