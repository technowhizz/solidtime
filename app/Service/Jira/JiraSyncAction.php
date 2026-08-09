<?php

declare(strict_types=1);

namespace App\Service\Jira;

enum JiraSyncAction: string
{
    /** No worklog exists for this group yet. */
    case Create = 'create';

    /**
     * A worklog exists but its total or start no longer matches solidtime - an entry was added
     * to the group, or one of them was edited. The original script skipped this case entirely,
     * silently dropping the extra time.
     */
    case Update = 'update';

    /** A worklog solidtime created whose entries have all been deleted or moved elsewhere. */
    case Delete = 'delete';

    /** Already in Jira and identical. Shown in the preview, but nothing is sent. */
    case Unchanged = 'unchanged';
}
