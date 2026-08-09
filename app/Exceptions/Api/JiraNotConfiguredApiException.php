<?php

declare(strict_types=1);

namespace App\Exceptions\Api;

class JiraNotConfiguredApiException extends ApiException
{
    public const string KEY = 'jira_not_configured';
}
