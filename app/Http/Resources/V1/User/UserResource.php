<?php

declare(strict_types=1);

namespace App\Http\Resources\V1\User;

use App\Enums\Weekday;
use App\Http\Resources\V1\BaseResource;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * @property User $resource
 */
class UserResource extends BaseResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, string|bool|int|null|array<string>>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var string $id ID of user */
            'id' => $this->resource->id,
            /** @var string $name Name of user */
            'name' => $this->resource->name,
            /** @var string $email Email of user */
            'email' => $this->resource->email,
            /** @var string|null $pending_email Email address awaiting verification (set when the user has requested an email change but not yet verified the new address) */
            'pending_email' => $this->resource->pending_email,
            /** @var string $profile_photo_url Profile photo URL */
            'profile_photo_url' => $this->resource->profile_photo_url,
            /** @var string $timezone Timezone (f.e. Europe/Berlin or America/New_York) */
            'timezone' => $this->resource->timezone,
            /** @var Weekday $week_start Starting day of the week */
            'week_start' => $this->resource->week_start->value,
            /** @var int $calendar_week_days Number of days shown in the calendar week view (1-7) */
            'calendar_week_days' => $this->resource->calendar_week_days,
            /** @var string $no_project_color Color used for time entries without a project (f.e. #6b7280 or #6b7280cc) */
            'no_project_color' => $this->resource->no_project_color,
        ];
    }
}
