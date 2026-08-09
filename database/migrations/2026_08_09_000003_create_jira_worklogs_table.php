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
        Schema::create('jira_worklogs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->foreign('organization_id')
                ->references('id')
                ->on('organizations')
                ->restrictOnDelete()
                ->cascadeOnUpdate();
            $table->uuid('user_id');
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->restrictOnDelete()
                ->cascadeOnUpdate();
            $table->string('issue_key');
            // The day the work happened, in the user's own timezone rather than UTC - an entry
            // started at 23:30 local belongs to that local day.
            $table->date('work_date');
            $table->text('comment')->nullable();
            // sha256 of issue key, work date and comment. Time entries are grouped by exactly
            // those three, so a group is identified without storing which entries formed it -
            // membership is recomputed at sync time and is therefore self healing.
            $table->string('group_hash');
            $table->unique(['organization_id', 'user_id', 'group_hash']);
            // Identifier of the worklog in Jira, needed to update or delete it later
            $table->string('jira_worklog_id');
            // What was last sent to Jira, so a changed group can be told apart from an
            // unchanged one without asking Jira
            $table->integer('duration_seconds');
            $table->dateTime('started_at');
            $table->dateTime('synced_at');
            $table->timestamps();
            // Drives both the per entry sync indicators and reconciliation, which both look up
            // a user's worklogs across a date range
            $table->index(['organization_id', 'user_id', 'work_date']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('jira_worklogs');
    }
};
