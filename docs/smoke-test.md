# Smoke Test — Real Devices

CI typechecks, runs unit + integration tests, builds, and runs Lighthouse — but it can't tap a real iPhone or Android device. Run this 9-scenario script before announcing v1.0, against the production deploy, on **both an iPhone (Safari) and an Android phone (Chrome)**.

A scenario "passes" if the listed expected behavior happens within ~5 seconds with no console errors and no broken visual states.

---

## 1. Sign-up + onboarding + first borrow + return

1. Open the deployed URL on a fresh device. Sign in with a phone you control (E.164 format).
2. Complete the OTP challenge.
3. Walk through the 3 onboarding screens (or Skip).
4. From the pegboard, tap a tool that is `available`. Open the borrow drawer. Confirm with the liability copy that matches the tool's tier.
5. Verify the loan appears under **/me → Active**.
6. Return the loan from the same screen.

**Expected:** loan moves to **Returned**; borrow counter on profile increments.

## 2. Admin: add an item with photo and tier requirement

1. As the owner, go to **/admin/items**.
2. Tap **Add item**. Photograph an item, supply name + description + category + tags.
3. Set instance count, set tier requirement to "friend".
4. Save.
5. Go back to the pegboard.

**Expected:** the new item appears with the photo. A **howdy**-tier user cannot tap the borrow button (button is disabled with a "Friend tier required" tooltip).

## 3. Donation flow: submit, accept, donor credit

1. As a non-owner user, go to **/donate** and submit a donation offer (name, photos, condition).
2. As the owner, go to **/admin/donations**.
3. Accept the donation; convert it to an item.
4. Verify the new item shows on the pegboard with the donor's display name credited in its description.

**Expected:** Notification fires to the donor that their donation was accepted.

## 4. Tier promotion celebration

1. As the owner, go to **/admin/members**. Find a friend-tier member.
2. Promote them to family.
3. Sign in as that member on a different device (or sign out + back in).
4. The celebration overlay should fire on the next `/me` read.
5. Reload `/me`. The celebration should NOT fire again.

**Expected:** confetti + "Welcome to Family" overlay one time only.

## 5. Push subscription + admin trigger + deeplink

1. As any user, go to **/me/profile → Notifications** and enable push.
2. Accept the browser permission prompt.
3. As the owner, trigger a push from **/admin/items** (e.g. flip an item's availability — anything that fires the notifier).
4. Wait up to 30s for the notification to land on the test device.
5. Tap the notification.

**Expected:** notification body matches the event; tap opens the relevant screen (not a 404).

## 6. PWA install + offline page + reconnect

1. On iOS Safari: **Share → Add to Home Screen**. On Android Chrome: **⋮ → Install app**.
2. Launch the installed app.
3. Toggle airplane mode.
4. Tap a tool. The offline page should render.
5. Disable airplane mode and reload.

**Expected:** Offline page is branded (not the browser default). Reload restores normal pegboard.

## 7. Reservation conflict

1. On Device A, sign in as user X. Open a tool with one instance and tap **Borrow**.
2. On Device B, sign in as user Y. Open the same tool and tap **Borrow** before user X confirms.
3. Have user Y confirm first; then user X confirms.

**Expected:** user X gets a 409 with an "alternates" suggestion (other available instances OR a "next available" date for the same instance).

## 8. Account deletion: schedule, cancel, schedule, anonymize

1. On a throwaway test account, go to **/me/profile → Danger zone → Delete my account**.
2. Confirm via OTP. Verify the banner appears with "scheduled for deletion in 30 days".
3. Tap **Cancel deletion**. Verify the banner disappears.
4. Schedule deletion again.
5. Either wait 30 days, OR manually invoke the `account-cleaner` Lambda from the console with an empty event.
6. Sign in as a different user who had a loan from that account. Confirm the borrower's display name has been replaced with a deterministic pseudonym (`Friend-XXXXXX`) on the loan history, donations, wishlist entries, and incidents.

**Expected:** all references anonymized; original Cognito identity is gone.

## 9. Audit log

1. As the owner, do three different admin actions (e.g. promote a member, accept a donation, edit an item).
2. Go to **/admin/activity**.
3. Each action should appear as a row with an actor, a target, a diff, and a timestamp.

**Expected:** every admin write is captured. The diff should make the change human-readable (e.g. `tier: friend → family`), not just a raw dump.

---

## Failure protocol

If a scenario fails, do **not** announce v1.0. File the failure as an issue, fix it on a branch, re-deploy to the staging stage, run the failing scenario again, then re-run the full smoke. The whole thing takes ~30 minutes per device once you've done it a few times.
