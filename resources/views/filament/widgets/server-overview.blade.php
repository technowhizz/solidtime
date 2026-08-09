<x-filament-widgets::widget>
    <x-filament::section>
        <div>
            <span class="text-gray-950 font-bold dark:text-white">Version</span>
            @if($version !== null)
                <span>v{{ $version }}</span>
            @else
                <span>-</span>
            @endif
            <br>
            <span class="text-gray-950 font-bold dark:text-white">Build</span>
            @if($build !== null)
                <span>{{ $build }}</span>
            @else
                <span>-</span>
            @endif

        </div>
    </x-filament::section>
</x-filament-widgets::widget>
