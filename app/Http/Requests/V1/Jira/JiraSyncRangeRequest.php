<?php

declare(strict_types=1);

namespace App\Http\Requests\V1\Jira;

use App\Http\Requests\V1\BaseFormRequest;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Contracts\Validation\Rule as RuleContract;
use Illuminate\Contracts\Validation\ValidationRule;
use Throwable;

class JiraSyncRangeRequest extends BaseFormRequest
{
    /**
     * Bounds how much a single sync can touch. Comfortably more than the calendar's widest
     * view, and short of "push my entire history" by accident.
     */
    public const int MAX_RANGE_DAYS = 62;

    /**
     * Local dates rather than timestamps: a worklog belongs to the day the user worked, in
     * their own timezone, which is also how Jira presents it.
     *
     * @return array<string, array<string|ValidationRule|RuleContract|Closure>>
     */
    public function rules(): array
    {
        return [
            // First day of the range, inclusive (example: 2026-08-03)
            'start' => [
                'required',
                'string',
                'date_format:Y-m-d',
            ],
            // Last day of the range, inclusive, at most 62 days after the start (example: 2026-08-09)
            'end' => [
                'required',
                'string',
                'date_format:Y-m-d',
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

                    if ($endDate->isBefore($startDate)) {
                        $fail('The end date must not be before the start date.');
                    }

                    if ($endDate->isAfter($startDate->addDays(self::MAX_RANGE_DAYS))) {
                        $fail('The date range must not be longer than '.self::MAX_RANGE_DAYS.' days.');
                    }
                },
            ],
        ];
    }

    public function getStartDate(): string
    {
        return (string) $this->validated('start');
    }

    public function getEndDate(): string
    {
        return (string) $this->validated('end');
    }
}
