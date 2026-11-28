# Firestore Security Specification

## 1. Data Invariants
- `/developers/{userId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId`; PII (`email`) is isolated from public reads and `list` queries are denied.
- `/apps/{appId}` stores ONLY public catalog metadata (never PII like `ownerEmail`); anyone may `get` or `list` published apps so permanent `?app=APP_ID` links work for unauthenticated visitors across devices.
- Creating, updating, or deleting `/apps/{appId}` requires an authenticated, email-verified user whose `request.auth.uid == ownerUid`. `id`, `ownerUid`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
- `/apps/{appId}/reviews/{reviewId}` requires an existing parent `/apps/{appId}` (`exists(...)`), authenticated `authorUid == request.auth.uid`, valid rating (`1..5`), and `createdAt == request.time`.

## 2. Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated `get` on `/developers/uid1` -> `PERMISSION_DENIED`
2. Authenticated `list` query on `/developers` -> `PERMISSION_DENIED`
3. Unauthenticated `create` on `/apps/app-123` -> `PERMISSION_DENIED`
4. Identity spoofing (`ownerUid: "other"`) on `create` `/apps/app-123` -> `PERMISSION_DENIED`
5. Shadow field injection (`ownerEmail` or `isAdmin: true`) on `create` `/apps/app-123` -> `PERMISSION_DENIED`
6. Cross-owner `update` or `delete` on `/apps/app-123` -> `PERMISSION_DENIED`
7. Mutating immutable `ownerUid` or `createdAt` on `update` `/apps/app-123` -> `PERMISSION_DENIED`
8. Client-forged timestamp (`updatedAt != request.time`) on `/apps/app-123` -> `PERMISSION_DENIED`
9. Non-HTTPS `externalApkUrl` (`javascript:alert(1)` or `http://...`) on `/apps/app-123` -> `PERMISSION_DENIED`
10. Oversized `screenshots` array (> 4) or oversized string (`name` > 120) -> `PERMISSION_DENIED`
11. Orphaned review on nonexistent `/apps/missing-id/reviews/rev-1` -> `PERMISSION_DENIED`
12. Invalid path variable ID (`../bad-id`) -> `PERMISSION_DENIED`
