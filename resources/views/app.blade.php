<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">

        <title inertia>{{ config('app.name', 'Laravel') }}</title>

        <!-- Favicons -->
        <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png">
        <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png">
        <link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png">
        <link rel="manifest" href="/favicons/site.webmanifest">
        <link rel="mask-icon" href="/favicons/safari-pinned-tab.svg" color="#000000">
        <link rel="shortcut icon" href="/favicons/favicon.ico">
        <meta name="msapplication-TileColor" content="#000000">
        <meta name="msapplication-config" content="/favicons/browserconfig.xml">
        <meta name="theme-color" content="#000000">

        {{--
            Apply the stored theme before the first paint. The Vue app only sets this class once
            its bundle has booted, and the colour tokens live entirely inside :root.dark and
            :root.light, so until then the background resolves to an undefined variable and the
            page paints white. Kept deliberately in sync with resources/js/utils/theme.ts.
        --}}
        <script>
            (function () {
                var theme = 'system';
                try {
                    theme = window.localStorage.getItem('theme') || 'system';
                } catch (e) {
                    // Storage can be unavailable, fall through to the media query
                }
                // useStorage writes the bare string, but tolerate a JSON quoted value
                theme = String(theme).replace(/^"|"$/g, '');
                if (theme !== 'light' && theme !== 'dark') {
                    // Matches theme.ts: only an explicit light preference gives light
                    theme = window.matchMedia('(prefers-color-scheme: light)').matches
                        ? 'light'
                        : 'dark';
                }
                document.documentElement.classList.add(theme);
            })();
        </script>

        <!-- Scripts -->
        @routes
        @vite(array_filter(\Nwidart\Modules\Module::getAssets(), fn($asset) => $asset !== 'resources/css/filament/admin/theme.css'))
        @inertiaHead
    </head>
    <body class="font-sans antialiased">
        @inertia
    </body>
</html>
