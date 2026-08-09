<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Exceptions\Api\JiraAuthenticationFailedApiException;
use App\Exceptions\Api\JiraNotConfiguredApiException;
use App\Exceptions\Api\JiraNotConnectedApiException;
use App\Exceptions\Api\JiraRequestFailedApiException;
use App\Http\Requests\V1\Jira\JiraConnectionUpdateRequest;
use App\Http\Requests\V1\Jira\JiraSettingsUpdateRequest;
use App\Http\Requests\V1\Jira\JiraSyncRangeRequest;
use App\Http\Resources\V1\Jira\JiraConnectionResource;
use App\Jobs\SyncJiraWorklogs;
use App\Models\JiraConnection;
use App\Models\Organization;
use App\Service\Jira\JiraClient;
use App\Service\Jira\JiraConfig;
use App\Service\Jira\JiraSyncRunStore;
use App\Service\Jira\JiraSyncService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Jira credentials are personal, so every endpoint here acts on the authenticated user's own
 * connection and their own time entries. Membership of the organization is all that is checked -
 * there is no way to sync, or look at the sync state of, anybody else's time.
 */
class JiraController extends Controller
{
    /**
     * Get the Jira connection of the currently authenticated user
     *
     * The Jira site is set per organization by an administrator, while credentials are personal,
     * so `is_configured` and `is_connected` are reported separately.
     *
     * @operationId getJiraConnection
     *
     * @throws AuthorizationException
     */
    public function show(Organization $organization): JiraConnectionResource
    {
        $this->checkPermission($organization, 'time-entries:view:own');

        return new JiraConnectionResource(
            app(JiraSyncService::class)->connectionFor($this->user(), $organization),
            app(JiraConfig::class)->siteUrl($organization),
        );
    }

    /**
     * Connect a Jira account for the currently authenticated user
     *
     * The credentials are checked against Jira before anything is stored, so an incorrect token
     * is reported straight away rather than at the first sync. Responds 201 the first time an
     * account is connected and 200 when an existing connection is replaced.
     *
     * @operationId updateJiraConnection
     *
     * @throws AuthorizationException
     * @throws JiraNotConfiguredApiException
     * @throws JiraAuthenticationFailedApiException
     * @throws JiraRequestFailedApiException
     */
    public function update(Organization $organization, JiraConnectionUpdateRequest $request): JiraConnectionResource
    {
        $this->checkPermission($organization, 'time-entries:view:own');
        $user = $this->user();

        $config = app(JiraConfig::class);
        $siteUrl = $config->siteUrl($organization);
        if ($siteUrl === null) {
            throw new JiraNotConfiguredApiException;
        }

        $connection = app(JiraSyncService::class)->connectionFor($user, $organization) ?? new JiraConnection;
        $connection->user_id = $user->getKey();
        $connection->organization_id = $organization->getKey();
        $connection->email = $request->getEmail();
        $connection->api_token = $request->getApiToken();
        $connection->requires_reauthentication = false;

        // Deliberately before save(), so failed credentials leave no connection behind
        $profile = app(JiraClient::class)->myself($connection);

        $connection->account_id = $profile['account_id'];
        $connection->display_name = $profile['display_name'];
        $connection->last_verified_at = Carbon::now();
        $connection->save();

        return new JiraConnectionResource($connection, $siteUrl);
    }

    /**
     * Update the sync settings of the currently authenticated user's Jira connection
     *
     * Sets the date before which work is treated as already logged in Jira. Use it after
     * importing history from another tracker, so the time the old process already sent is not
     * logged a second time.
     *
     * @operationId updateJiraSettings
     *
     * @throws AuthorizationException
     * @throws JiraNotConfiguredApiException
     * @throws JiraNotConnectedApiException
     */
    public function updateSettings(Organization $organization, JiraSettingsUpdateRequest $request): JiraConnectionResource
    {
        $this->checkPermission($organization, 'time-entries:view:own');

        $syncService = app(JiraSyncService::class);
        $connection = $syncService->requireConnection($this->user(), $organization);
        $connection->sync_from_date = $request->getSyncFromDate();
        $connection->save();

        return new JiraConnectionResource($connection, app(JiraConfig::class)->siteUrl($organization));
    }

    /**
     * Disconnect the Jira account of the currently authenticated user
     *
     * The stored credentials are deleted. Worklogs already in Jira are left alone, but solidtime
     * forgets that it created them, so reconnecting and syncing the same range again would log
     * the work a second time.
     *
     * @operationId deleteJiraConnection
     *
     * @throws AuthorizationException
     */
    public function destroy(Organization $organization): JsonResponse
    {
        $this->checkPermission($organization, 'time-entries:view:own');

        app(JiraSyncService::class)->connectionFor($this->user(), $organization)?->delete();

        return response()->json(null, 204);
    }

    /**
     * Get the Jira sync state of the current user's time entries in a date range
     *
     * Returns a map of time entry ID to state, which drives the indicators on the calendar, the
     * time list and the timesheet. States are `synced`, `pending`, `outdated`, `no_reference`
     * and `ignored`.
     *
     * @operationId getJiraSyncStatus
     *
     * @throws AuthorizationException
     */
    public function syncStatus(Organization $organization, JiraSyncRangeRequest $request): JsonResponse
    {
        $this->checkPermission($organization, 'time-entries:view:own');

        return response()->json([
            'data' => app(JiraSyncService::class)->statusFor(
                $this->user(),
                $organization,
                $request->getStartDate(),
                $request->getEndDate(),
            ),
        ]);
    }

    /**
     * Preview what a Jira sync would do for a date range
     *
     * Nothing is sent to Jira. Returns the worklogs that would be created, updated, deleted or
     * left unchanged, plus the entries that will be skipped and why.
     *
     * @operationId getJiraSyncPreview
     *
     * @throws AuthorizationException
     * @throws JiraNotConfiguredApiException
     * @throws JiraNotConnectedApiException
     */
    public function syncPreview(Organization $organization, JiraSyncRangeRequest $request): JsonResponse
    {
        $this->checkPermission($organization, 'time-entries:view:own');

        $syncService = app(JiraSyncService::class);
        $syncService->requireConnection($this->user(), $organization);

        return response()->json([
            'data' => $syncService->plan(
                $this->user(),
                $organization,
                $request->getStartDate(),
                $request->getEndDate(),
            )->toArray(),
        ]);
    }

    /**
     * Start a Jira sync for a date range
     *
     * Queues the work and returns a run ID to poll. The plan is recomputed inside the job, so
     * what is sent reflects the time entries as they are when it runs rather than when the
     * preview was generated.
     *
     * @operationId syncJira
     *
     * @throws AuthorizationException
     * @throws JiraNotConfiguredApiException
     * @throws JiraNotConnectedApiException
     */
    public function sync(Organization $organization, JiraSyncRangeRequest $request): JsonResponse
    {
        $this->checkPermission($organization, 'time-entries:view:own');
        $user = $this->user();

        $syncService = app(JiraSyncService::class);
        // Fail fast, so a missing connection is a 400 here rather than a failed run later
        $syncService->requireConnection($user, $organization);

        $plan = $syncService->plan($user, $organization, $request->getStartDate(), $request->getEndDate());

        $runId = Str::uuid()->toString();
        $runStore = app(JiraSyncRunStore::class);
        $runStore->queued($user, $runId, $request->getStartDate(), $request->getEndDate(), count($plan->actionableItems()));

        SyncJiraWorklogs::dispatch($user, $organization, $runId, $request->getStartDate(), $request->getEndDate());

        return response()->json([
            'data' => $runStore->get($user, $runId),
        ]);
    }

    /**
     * Get the progress of a Jira sync run
     *
     * Runs are per user and expire an hour after they are started.
     *
     * @operationId getJiraSyncRun
     *
     * @throws AuthorizationException
     */
    public function syncRun(Organization $organization, string $runId): JsonResponse
    {
        $this->checkPermission($organization, 'time-entries:view:own');

        $state = app(JiraSyncRunStore::class)->get($this->user(), $runId);
        if ($state === null) {
            return response()->json(['message' => 'Sync run not found'], 404);
        }

        return response()->json(['data' => $state]);
    }
}
