<?php

declare(strict_types=1);

namespace App\Service\GoogleCalendar;

use Carbon\CarbonImmutable;

class GoogleCalendarEventDto
{
    public string $id;

    public string $title;

    public CarbonImmutable $start;

    public CarbonImmutable $end;

    public bool $isAllDay;

    public ?string $htmlLink;

    public function __construct(string $id, string $title, CarbonImmutable $start, CarbonImmutable $end, bool $isAllDay, ?string $htmlLink)
    {
        $this->id = $id;
        $this->title = $title;
        $this->start = $start;
        $this->end = $end;
        $this->isAllDay = $isAllDay;
        $this->htmlLink = $htmlLink;
    }
}
