<?php

declare(strict_types=1);

namespace App\Http\Requests\V1\GoogleCalendar;

use App\Http\Requests\V1\BaseFormRequest;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Contracts\Validation\Rule as RuleContract;
use Illuminate\Contracts\Validation\ValidationRule;
use Throwable;

class GoogleCalendarEventIndexRequest extends BaseFormRequest
{
    /**
     * The longest range that can be requested in one call, to bound the work done upstream.
     */
    public const int MAX_RANGE_DAYS = 62;

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, array<string|ValidationRule|RuleContract|Closure>>
     */
    public function rules(): array
    {
        return [
            // Start of the range in UTC (example: 2021-01-01T00:00:00Z)
            'start' => [
                'required',
                'string',
                'date_format:Y-m-d\TH:i:s\Z',
                'before:end',
            ],
            // End of the range in UTC, at most 62 days after the start (example: 2021-02-01T00:00:00Z)
            'end' => [
                'required',
                'string',
                'date_format:Y-m-d\TH:i:s\Z',
                function (string $attribute, mixed $value, Closure $fail): void {
                    $start = $this->input('start');
                    if (! is_string($start) || ! is_string($value)) {
                        return;
                    }

                    try {
                        $startDate = CarbonImmutable::parse($start, 'UTC');
                        $endDate = CarbonImmutable::parse($value, 'UTC');
                    } catch (Throwable) {
                        // The date_format rule already reports an unparsable value
                        return;
                    }

                    if ($endDate->isAfter($startDate->addDays(self::MAX_RANGE_DAYS))) {
                        $fail('The time range must not be longer than '.self::MAX_RANGE_DAYS.' days.');
                    }
                },
            ],
        ];
    }

    public function getStart(): CarbonImmutable
    {
        return CarbonImmutable::parse($this->validated('start'), 'UTC');
    }

    public function getEnd(): CarbonImmutable
    {
        return CarbonImmutable::parse($this->validated('end'), 'UTC');
    }
}
