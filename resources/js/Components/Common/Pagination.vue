<script setup lang="ts">
import {
    PaginationEllipsis,
    PaginationFirst,
    PaginationLast,
    PaginationList,
    PaginationListItem,
    PaginationNext,
    PaginationPrev,
    PaginationRoot,
} from 'radix-vue';
import {
    ChevronDoubleLeftIcon,
    ChevronDoubleRightIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    EllipsisHorizontalIcon,
} from '@heroicons/vue/20/solid';
import {
    buttonVariants,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/packages/ui/src';
import { cn } from '@/lib/utils';
import { computed, watch } from 'vue';

const page = defineModel<number>('page', { default: 1 });
const itemsPerPage = defineModel<number>('itemsPerPage', { default: 15 });

const props = withDefaults(
    defineProps<{
        total: number;
        siblingCount?: number;
        showEdges?: boolean;
        perPageOptions?: number[];
        itemLabel?: string;
    }>(),
    {
        siblingCount: 1,
        showEdges: true,
        // 500 is the hard cap the time entries API validates `limit` against, so no option may
        // exceed it.
        perPageOptions: () => [15, 25, 50, 100, 250, 500],
        itemLabel: 'Entries',
    }
);

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / itemsPerPage.value)));

const rangeStart = computed(() =>
    props.total === 0 ? 0 : (page.value - 1) * itemsPerPage.value + 1
);
const rangeEnd = computed(() => Math.min(page.value * itemsPerPage.value, props.total));

// The select works in strings, the page size is a number.
const perPageValue = computed({
    get: () => String(itemsPerPage.value),
    set: (value: string) => {
        itemsPerPage.value = parseInt(value);
    },
});

watch(page, (value) => {
    if (value > pageCount.value) {
        page.value = pageCount.value;
    }
});

watch(pageCount, (value) => {
    if (page.value > value) {
        page.value = value;
    }
});

// The shared buttonVariants ghost/outline hover is `bg-white/5`, which is invisible in light
// mode. Override it with a theme-aware hover that shows in both light and dark mode.
const hoverClass = 'hover:bg-black/5 dark:hover:bg-white/5';
const navButtonClass = cn(buttonVariants({ variant: 'ghost', size: 'icon' }), hoverClass);

function pageButtonClass(isActive: boolean): string {
    return cn(
        buttonVariants({ variant: isActive ? 'outline' : 'ghost', size: 'icon' }),
        hoverClass
    );
}
</script>

<template>
    <div
        v-if="props.total > 0"
        class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 py-8 px-4 sm:px-6">
        <span
            data-testid="pagination_range"
            class="text-sm text-text-secondary justify-self-center sm:justify-self-start">
            {{ props.itemLabel }} {{ rangeStart }}–{{ rangeEnd }} of {{ props.total }}
        </span>

        <PaginationRoot
            v-if="pageCount > 1"
            v-model:page="page"
            :total="props.total"
            :items-per-page="itemsPerPage"
            :sibling-count="props.siblingCount"
            :show-edges="props.showEdges"
            class="flex justify-center">
            <PaginationList v-slot="{ items }" class="flex items-center gap-1">
                <PaginationFirst :class="navButtonClass">
                    <ChevronDoubleLeftIcon class="size-4" />
                </PaginationFirst>
                <PaginationPrev :class="navButtonClass">
                    <ChevronLeftIcon class="size-4" />
                </PaginationPrev>
                <template v-for="(item, index) in items" :key="index">
                    <PaginationListItem
                        v-if="item.type === 'page'"
                        :value="item.value"
                        :class="pageButtonClass(item.value === page)">
                        {{ item.value }}
                    </PaginationListItem>
                    <PaginationEllipsis
                        v-else
                        :index="index"
                        class="flex size-9 items-center justify-center text-text-tertiary">
                        <EllipsisHorizontalIcon class="size-4" />
                    </PaginationEllipsis>
                </template>
                <PaginationNext :class="navButtonClass">
                    <ChevronRightIcon class="size-4" />
                </PaginationNext>
                <PaginationLast :class="navButtonClass">
                    <ChevronDoubleRightIcon class="size-4" />
                </PaginationLast>
            </PaginationList>
        </PaginationRoot>
        <!-- Keeps the range label and the page size select in their outer grid columns when
             there is only a single page and no nav to show. -->
        <div v-else class="hidden sm:block"></div>

        <div class="flex items-center gap-2 justify-self-center sm:justify-self-end">
            <Select v-model="perPageValue">
                <SelectTrigger
                    size="sm"
                    data-testid="pagination_per_page"
                    aria-label="Entries per page">
                    <SelectValue>{{ itemsPerPage }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem
                        v-for="option in props.perPageOptions"
                        :key="option"
                        :value="String(option)">
                        {{ option }}
                    </SelectItem>
                </SelectContent>
            </Select>
            <span class="text-sm text-text-secondary">/ page</span>
        </div>
    </div>
</template>
