<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('jira_connections', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->restrictOnDelete()
                ->cascadeOnUpdate();
            // Credentials are paired with an organization's Jira site, so a user who belongs to
            // two organizations with two different sites holds two connections.
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->restrictOnDelete()
                ->cascadeOnUpdate();
            $table->unique(['user_id', 'organization_id']);
            // The Atlassian account the token belongs to. Both are only used to show which
            // account is linked, and are filled in from /myself when the token is saved.
            $table->string('email');
            $table->string('account_id')->nullable();
            $table->string('display_name')->nullable();
            // Encrypted at rest, so the ciphertext needs more room than the token itself
            $table->text('api_token');
            $table->boolean('requires_reauthentication')->default(false);
            // Work on or after this local date is eligible for syncing. Set it when the time
            // before it is already in Jira - typically history imported from Toggl or Clockify
            // that was logged by the old process. Null means no cutoff.
            $table->date('sync_from_date')->nullable();
            $table->dateTime('last_verified_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('jira_connections');
    }
};
