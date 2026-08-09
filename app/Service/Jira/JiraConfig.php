<?php

declare(strict_types=1);

namespace App\Service\Jira;

use App\Models\Organization;

class JiraConfig
{
    /**
     * Whether an admin has pointed the organization at a Jira site. Everything user facing
     * gates on this, so an organization that does not use Jira never sees the integration.
     */
    public function isConfigured(Organization $organization): bool
    {
        return $this->siteUrl($organization) !== null;
    }

    /**
     * The organization's Jira site, normalised to a scheme and host with no trailing slash or
     * path. Returns null if it is missing or not a usable https URL.
     */
    public function siteUrl(Organization $organization): ?string
    {
        return self::normaliseSiteUrl($organization->jira_site_url);
    }

    /**
     * Accepts what someone is likely to paste - "acme.atlassian.net",
     * "https://acme.atlassian.net/", "https://acme.atlassian.net/jira/your-work" - and reduces
     * it to the origin the REST API lives under.
     */
    public static function normaliseSiteUrl(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        // A bare host is by far the most common paste, so assume https rather than rejecting it
        if (! str_contains($value, '://')) {
            $value = 'https://'.$value;
        }

        $parts = parse_url($value);
        if ($parts === false || ! isset($parts['host'])) {
            return null;
        }

        // Tokens travel on every request, so plaintext is not an option
        if (($parts['scheme'] ?? null) !== 'https') {
            return null;
        }

        $host = strtolower($parts['host']);
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';

        return 'https://'.$host.$port;
    }

    /**
     * The project keys issue detection is restricted to, uppercased. An empty list means no
     * restriction, and anything shaped like an issue key is accepted.
     *
     * @return list<string>
     */
    public function projectKeys(Organization $organization): array
    {
        return self::parseProjectKeys($organization->jira_project_keys);
    }

    /**
     * @return list<string>
     */
    public static function parseProjectKeys(?string $value): array
    {
        $keys = [];
        // Tolerates commas, whitespace or both, since this is a free text field
        foreach (preg_split('/[\s,]+/', (string) $value) ?: [] as $key) {
            $key = strtoupper(trim($key));
            if ($key !== '') {
                $keys[] = $key;
            }
        }

        return array_values(array_unique($keys));
    }
}
