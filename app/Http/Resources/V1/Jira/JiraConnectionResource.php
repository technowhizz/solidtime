<?php

declare(strict_types=1);

namespace App\Http\Resources\V1\Jira;

use App\Http\Resources\V1\BaseResource;
use App\Models\JiraConnection;
use Illuminate\Http\Request;

/**
 * @property-read JiraConnection|null $resource
 */
class JiraConnectionResource extends BaseResource
{
    public function __construct(?JiraConnection $resource, private readonly ?string $siteUrl)
    {
        parent::__construct($resource);
    }

    /**
     * Transform the resource into an array.
     *
     * Note: a user without a connection gets the same shape with `is_connected` false, so the
     * settings card only has to deal with one response shape. The API token is deliberately
     * never returned.
     *
     * @return array<string, string|bool|null>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var bool $is_configured Whether an administrator has set a Jira site URL for the organization */
            'is_configured' => $this->siteUrl !== null,
            /** @var string|null $site_url Jira site the organization logs work to */
            'site_url' => $this->siteUrl,
            /** @var bool $is_connected Whether the current user has connected their Jira account */
            'is_connected' => $this->resource !== null,
            /** @var string|null $email Email address of the connected Atlassian account */
            'email' => $this->resource?->email,
            /** @var string|null $display_name Display name of the connected Atlassian account */
            'display_name' => $this->resource?->display_name,
            /** @var string|null $sync_from_date Local date (Y-m-d) before which work is treated as already logged in Jira. Null means no cutoff. */
            'sync_from_date' => $this->resource?->sync_from_date?->format('Y-m-d'),
            /** @var bool $requires_reauthentication Whether Jira rejected the stored token and the account needs to be connected again */
            'requires_reauthentication' => $this->resource->requires_reauthentication ?? false,
            /** @var string|null $connected_at When the Jira account was connected (ISO 8601 format, UTC timezone, example: 2024-02-26T17:17:17Z) */
            'connected_at' => $this->formatDateTime($this->resource?->created_at),
        ];
    }
}
