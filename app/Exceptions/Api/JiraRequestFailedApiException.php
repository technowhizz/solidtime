<?php

declare(strict_types=1);

namespace App\Exceptions\Api;

class JiraRequestFailedApiException extends ApiException
{
    public const string KEY = 'jira_request_failed';

    /**
     * What Jira said, when it said anything useful - "Issue does not exist" for a typo'd key,
     * for instance. Surfaced per item in the sync results, where the generic message would
     * leave someone with no idea which ticket was wrong.
     */
    public ?string $detail = null;

    public static function withDetail(?string $detail): self
    {
        $exception = new self;
        $exception->detail = $detail;

        return $exception;
    }

    public function getTranslatedMessage(): string
    {
        $message = parent::getTranslatedMessage();

        return $this->detail === null ? $message : $message.' ('.$this->detail.')';
    }
}
