<?php

declare(strict_types=1);

namespace App\Service\Jira;

use App\Exceptions\Api\JiraAuthenticationFailedApiException;
use App\Exceptions\Api\JiraNotConfiguredApiException;
use App\Exceptions\Api\JiraRequestFailedApiException;
use App\Models\JiraConnection;
use Carbon\CarbonInterface;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Talks to the Jira Cloud REST API on behalf of one user.
 *
 * Deliberately built on the Http facade rather than a Guzzle client of its own, so that
 * Http::preventStrayRequests() in tests/TestCase.php actually covers it - the trap the Google
 * integration hit with Socialite.
 */
class JiraClient
{
    private const int TIMEOUT_SECONDS = 20;

    private const int CONNECT_TIMEOUT_SECONDS = 5;

    /**
     * Jira's own timestamp format: milliseconds and a numeric offset, ex.
     * 2026-08-09T09:00:00.000+0100. The offset is the user's real one - sending a local time
     * stamped +0000 is what made the original script log work at the wrong hour.
     */
    public const string STARTED_FORMAT = 'Y-m-d\TH:i:s.vO';

    public function __construct(private readonly JiraConfig $config) {}

    /**
     * The account the token belongs to. Used to check credentials when they are saved, and to
     * show which account is linked.
     *
     * @return array{account_id: string|null, display_name: string|null, email: string|null}
     */
    public function myself(JiraConnection $connection): array
    {
        $response = $this->request($connection, 'get', '/myself');

        return [
            'account_id' => $this->stringOrNull($response->json('accountId')),
            'display_name' => $this->stringOrNull($response->json('displayName')),
            'email' => $this->stringOrNull($response->json('emailAddress')),
        ];
    }

    /**
     * @return string The new worklog's id in Jira
     */
    public function createWorklog(JiraConnection $connection, string $issueKey, ?string $comment, CarbonInterface $startedAt, int $durationSeconds): string
    {
        $response = $this->request(
            $connection,
            'post',
            '/issue/'.rawurlencode($issueKey).'/worklog',
            $this->worklogPayload($comment, $startedAt, $durationSeconds),
        );

        $id = $this->stringOrNull($response->json('id'));
        if ($id === null) {
            Log::warning('Jira accepted a worklog but returned no id', [
                'issue_key' => $issueKey,
                'body' => $response->body(),
            ]);

            throw new JiraRequestFailedApiException;
        }

        return $id;
    }

    public function updateWorklog(JiraConnection $connection, string $issueKey, string $worklogId, ?string $comment, CarbonInterface $startedAt, int $durationSeconds): void
    {
        $this->request(
            $connection,
            'put',
            '/issue/'.rawurlencode($issueKey).'/worklog/'.rawurlencode($worklogId),
            $this->worklogPayload($comment, $startedAt, $durationSeconds),
        );
    }

    public function deleteWorklog(JiraConnection $connection, string $issueKey, string $worklogId): void
    {
        $this->request(
            $connection,
            'delete',
            '/issue/'.rawurlencode($issueKey).'/worklog/'.rawurlencode($worklogId),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function worklogPayload(?string $comment, CarbonInterface $startedAt, int $durationSeconds): array
    {
        $payload = [
            'started' => $startedAt->format(self::STARTED_FORMAT),
            'timeSpentSeconds' => $durationSeconds,
        ];

        if ($comment !== null) {
            $payload['comment'] = self::toAtlassianDocument($comment);
        }

        return $payload;
    }

    /**
     * REST v3 takes rich text rather than a plain string, so the comment is wrapped in the
     * smallest valid Atlassian Document Format node.
     *
     * @return array<string, mixed>
     */
    public static function toAtlassianDocument(string $text): array
    {
        return [
            'type' => 'doc',
            'version' => 1,
            'content' => [
                [
                    'type' => 'paragraph',
                    'content' => [
                        [
                            'type' => 'text',
                            'text' => $text,
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>|null  $payload
     */
    private function request(JiraConnection $connection, string $method, string $path, ?array $payload = null): Response
    {
        $organization = $connection->organization()->first();
        $siteUrl = $organization === null ? null : $this->config->siteUrl($organization);
        if ($siteUrl === null) {
            throw new JiraNotConfiguredApiException;
        }

        $url = $siteUrl.'/rest/api/3'.$path;
        // Bulk syncing an old week would otherwise mail every watcher on every issue touched
        $query = ['notifyUsers' => 'false'];

        try {
            $request = Http::asJson()
                ->withBasicAuth($connection->email, $connection->api_token)
                ->timeout(self::TIMEOUT_SECONDS)
                ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS);

            $response = match ($method) {
                'get' => $request->get($url),
                'post' => $request->post($url.'?'.http_build_query($query), $payload ?? []),
                'put' => $request->put($url.'?'.http_build_query($query), $payload ?? []),
                'delete' => $request->delete($url.'?'.http_build_query($query)),
                default => throw new JiraRequestFailedApiException,
            };
        } catch (ConnectionException $e) {
            Log::warning('Could not reach Jira', [
                'message' => $e->getMessage(),
            ]);

            throw new JiraRequestFailedApiException;
        }

        // 403 comes back for a token that is valid but lacks permission on the issue. That is
        // per issue rather than per credential, so it must not flag the whole connection.
        if ($response->status() === 401) {
            throw new JiraAuthenticationFailedApiException;
        }

        if ($response->failed()) {
            Log::warning('Jira request failed', [
                'method' => $method,
                'path' => $path,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            throw JiraRequestFailedApiException::withDetail($this->errorDetail($response));
        }

        return $response;
    }

    /**
     * Jira reports problems as {"errorMessages": [...], "errors": {...}}. Pulling the first one
     * out turns "the request failed" into "Issue does not exist".
     */
    private function errorDetail(Response $response): ?string
    {
        $messages = $response->json('errorMessages');
        if (is_array($messages)) {
            foreach ($messages as $message) {
                if (is_string($message) && $message !== '') {
                    return $message;
                }
            }
        }

        $errors = $response->json('errors');
        if (is_array($errors)) {
            foreach ($errors as $error) {
                if (is_string($error) && $error !== '') {
                    return $error;
                }
            }
        }

        return null;
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
