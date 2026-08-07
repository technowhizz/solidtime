<?php

declare(strict_types=1);

namespace App\Http\Resources\V1\GoogleCalendar;

use Illuminate\Http\Resources\Json\ResourceCollection;

class GoogleCalendarEventCollection extends ResourceCollection
{
    /**
     * The resource that this resource collects.
     *
     * @var string
     */
    public $collects = GoogleCalendarEventResource::class;
}
