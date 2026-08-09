<?php

declare(strict_types=1);

namespace App\Rules;

use App\Service\Jira\JiraConfig;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

class JiraSiteUrlRule implements ValidationRule
{
    /**
     * Accepts anything that reduces to an https origin, so a bare host is fine but plain http
     * is not - the API token travels on every request.
     *
     * @param  Closure(string): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        // Clearing the field is how an organization turns the integration off
        if ($value === null || $value === '') {
            return;
        }

        if (! is_string($value)) {
            $fail(__('validation.string'));

            return;
        }

        if (JiraConfig::normaliseSiteUrl($value) === null) {
            $fail('The :attribute must be an https URL, for example https://your-org.atlassian.net.');
        }
    }
}
