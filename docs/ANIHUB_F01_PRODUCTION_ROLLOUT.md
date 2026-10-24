# AniHub F01 — Production Activation and Safe Rollback Runbook

> **DOCUMENT STATUS:** Operational rollout and rollback guidance, updated October 24, 2026.
> **EXECUTION NOTICE:** This document does not authorize a deployment or production data change.

## 1. Activation model

Automatic Grouping is an authenticated AniHub capability. In a production build it is enabled when:

- Firebase project ID is exactly `anihub-73f72`; and
- the current Firebase Auth user has a non-empty UID.

Every authenticated user receives grouping presentation and automatic reconciliation. There are no grouping-specific Remote Config parameters, UID allowlists, canary claims, or percentage cohorts. Localhost development retains its explicit local opt-in and test-UID restriction; the isolated emulator preview retains its existing isolation checks.

Grouping-aware data compatibility is unconditional. Moves between Watchlist and Completed, Collection deletion, account deletion, singleton dissolution, reservation cleanup, and Collection counters must remain safe even if presentation or reconciliation is unavailable.

## 2. Release prerequisites

- Published Firestore rules must match the reviewed `firestore.rules` and support `groups`, `groupNameKeys`, membership validation, grouping metadata, and Collection counters.
- Run grouping, Watchlist, Completed, custom Collection, account deletion, Up Next, and Individual Library Search regressions.
- Run Firestore rules tests, scoped ESLint, the production build, and `git diff --check`.
- Confirm the production environment targets `anihub-73f72` and does not request Firebase emulators.
- Review the complete staged diff before opening or merging a pull request.

No Firestore migration is required. Existing ungrouped documents remain valid, while saved relationship metadata can be reconciled incrementally by the existing bounded and idempotent client flow.

## 3. Production behavior

After an approved application deployment:

- Group cards, group detail views, manual group controls, and **Organize Library** are visible to authenticated users.
- Automatic reconciliation runs only after the authenticated user's scoped library data is loaded and its stable fingerprint changes.
- Reconciliation remains debounced and prevents overlapping work for the same user and scope.
- Sign-out or account/scope changes invalidate pending work; stale completions cannot update another account's UI state.
- Firestore Security Rules remain the authorization boundary. Client activation never grants cross-user access.
- Up Next continues to use derived, non-persisted grouping and its independent sequel-discovery cache.
- Individual Library Search needs no separate activation.

The old grouping Remote Config keys may remain published in Firebase Console, but the application no longer fetches or reads them. They can be removed operationally after the new client is deployed and verified.

## 4. Monitoring

Monitor these indicators after release:

| Indicator | Investigate | Roll back application when |
| :--- | :--- | :--- |
| Firestore permission denials | Sustained increase on owned-library operations | Core Watchlist, Completed, or Collection operations fail broadly |
| Reconciliation activity | Repeated writes for an unchanged scope | A reconciliation loop or material quota spike is confirmed |
| Group integrity | Any orphan reservation or counter drift | Data loss, dangling memberships, or repeated corruption is observed |
| Client errors | Grouping-related increase | Users cannot safely view or manage saved libraries |

## 5. Rollback

There is no runtime grouping emergency switch after this change. Rollback is an application-release operation:

1. Stop further rollout or restore the last known-good application bundle through the hosting release mechanism.
2. Do **not** roll back the grouping-compatible Firestore rules while grouped documents exist.
3. Do **not** remove grouping-aware cleanup from movement, Collection deletion, or account deletion paths.
4. Verify Watchlist, Completed, and custom Collection documents remain present and readable.
5. Check for dangling `groupId` references, orphaned `groupNameKeys`, and Collection `groupingState.groupCount` drift.

An already-started Firestore transaction cannot be cancelled by sign-out, but it remains scoped to the UID captured when it began and is still constrained by Firestore ownership rules. The client discards stale completion state after identity changes.

## 6. Immediate stop conditions

- Sustained permission-denied errors on normal owned-library actions.
- Any saved-anime loss during movement, grouping, or deletion cleanup.
- Account or Collection deletion leaving owned grouping documents behind.
- A confirmed automatic reconciliation loop.
- An unexpected Firestore or AniList request spike attributable to grouping.

## 7. Approval checkpoints

| Gate | Requirement | Status |
| :--- | :--- | :--- |
| Rules | Published rules match the reviewed local rules | Verified October 24, 2026 |
| Automated verification | Relevant tests, lint, build, and diff check pass | Required before PR |
| Application release | Reviewed production bundle is deployed | Not performed by this task |
| Post-release verification | Authenticated users see grouping and normal library operations remain healthy | Required after deployment |
