<?php

declare(strict_types=1);

namespace App\Filament\Widgets;

use Filament\Widgets\Widget;

class ServerOverview extends Widget
{
    protected static string $view = 'filament.widgets.server-overview';

    /**
     * @return array<string, mixed>
     */
    protected function getViewData(): array
    {
        /** @var string|null $currentVersion */
        $currentVersion = config('app.version');
        /** @var string|null $build */
        $build = config('app.build');

        // Upstream also showed whether a newer version existed, which it learned by posting this
        // installation's version and URL to app.solidtime.io. That call is gone, so there is
        // nothing to compare against.

        return [
            'version' => $currentVersion,
            'build' => $build,
            'environment' => config('app.env'),
        ];
    }
}
