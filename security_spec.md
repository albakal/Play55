# Firestore Security Specification

## 1. Data Invariants
- Every document in `/developers/{userId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId`.
- `uid` and `createdAt` are immutable once created.
- `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
- PII (`email`) is strictly isolated to owner-only `get` access; public reads and `list` queries on `/developers` are completely denied.

## 2. Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated `get` on `/developers/uid1` -> `PERMISSION_DENIED`
2. Authenticated `get` on another user's `/developers/uid2` -> `PERMISSION_DENIED`
3. Authenticated `list` query on `/developers` -> `PERMISSION_DENIED`
4. Unverified email (`email_verified: false`) `create` on `/developers/uid1` -> `PERMISSION_DENIED`
5. Identity spoofing (`uid: "other"`) on `create` `/developers/uid1` -> `PERMISSION_DENIED`
6. Shadow field injection (`isAdmin: true`) on `create` -> `PERMISSION_DENIED`
7. Shadow field injection (`role: "admin"`) on `update` -> `PERMISSION_DENIED`
8. Mutating immutable `uid` on `update` -> `PERMISSION_DENIED`
9. Mutating immutable `createdAt` on `update` -> `PERMISSION_DENIED`
10. Client-forged timestamp (`updatedAt != request.time`) -> `PERMISSION_DENIED`
11. Oversized `displayName` (> 100 chars) -> `PERMISSION_DENIED`
12. Invalid path variable ID (`../bad-id`) -> `PERMISSION_DENIED`
