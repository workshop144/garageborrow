# {{tenant_name}} — Privacy Policy

**Last updated: April 25, 2026**

Short version: we collect the least we can to make the app work, we don't sell or share your data, and you can delete it whenever you want. The long version follows.

---

## What we collect

To make {{tenant_name}} work, we need a few things about you:

- **Phone number** — for SMS verification and so we can text you about borrows. This is your account ID.
- **Display name** — whatever you want to be called in the app. Defaults to "FirstName L." but you can change it.
- **Profile photo** (optional) — only if you upload one.
- **Borrow history** — what you've borrowed, when, when you returned it. So Dad knows where his stuff is.
- **Vouching info** — if someone vouches for you when you join, we record who.
- **Item photos / donation photos you upload** — stored in the garage's image library.
- **Notification preferences** — your settings for what reminds you when.
- **App usage logs** — basic stuff like errors and login times. No tracking pixels, no analytics services.

That's it. We do not collect:

- Your address (Dad knows where you live or doesn't, neither belongs in the app)
- Your email (we use SMS — no email collection)
- Your location in real-time
- Your contacts, photos library, or anything else on your phone
- Anything from third-party services
- Any payment info — there are no payments

---

## What we use it for

Strictly to run the lending operation:

- Verifying you are who you say you are (SMS code on signup)
- Texting you about your borrows, reservations, and waitlist updates
- Showing your borrow history to you and to Dad
- Showing your name + active borrows to other garage members (unless you've turned on hidden mode)
- Helping Dad decide whether to promote you to a higher trust tier
- Diagnosing app problems

We do not:

- Sell your data to anyone
- Share your data with advertisers (there are no ads)
- Use your data to train AI models
- Use your data for anything other than running the garage

---

## Who sees your data

- **You** — you can see all of your own data in the app.
- **Dad (the garage owner)** — sees everything you've borrowed, your phone number, vouching history, and your tier. Does not see things you've never told the app.
- **Other garage members** — see your display name, current borrows, and total borrow count, *only if* your profile is set to visible. They never see your phone number or full name.
- **AWS** — our cloud provider stores the data. Standard cloud hosting. They don't read it.
- **Twilio / AWS SNS** — sends our SMS messages. They see your phone number and the text content (verification codes, borrow reminders).
- **Nobody else.** No analytics services, no marketing partners, no data brokers.

---

## How long we keep it

- **Active account:** as long as you use the app.
- **You delete your account:** soft-delete immediately, hard-delete after 30 days. Your borrow history stays in Dad's records as "former member" for inventory tracking, with no personal identifiers attached.
- **Inactive accounts:** if you don't open the app for 18 months, we may delete the account and notify you by SMS first.
- **App logs:** 90 days, then deleted automatically.

---

## Your rights

You can, at any time, from the app's settings:

- View all the data we have about you
- Export it (we'll email you a JSON file)
- Change your display name
- Toggle profile visibility (visible / hidden)
- Change notification preferences
- Delete your account and all associated personal data

If you'd rather do any of the above by texting Dad instead, that works too.

---

## Cookies / local storage

The app stores a few things on your device to keep you logged in and remember your preferences:

- Auth token (so you don't have to re-verify your phone every visit)
- Your display preferences (light/dark mode, notification toggles)
- Service worker cache for offline use

That's local to your phone or browser. Not tracking.

---

## Kids

{{tenant_name}} is not designed for kids under 13, and we don't knowingly collect data from them. If you're under 18, you need a parent on the account, and the parent is responsible for the account and the data.

---

## California / EU folks

We built this for one local community, but if you happen to live somewhere with stronger privacy laws (California's CCPA, the EU's GDPR), you have the right to know what we collect, request a copy, request deletion, and not be discriminated against for exercising those rights. The app gives you all of that in settings. If you can't find it or it's broken, text Dad.

---

## Security

We use industry-standard practices: data encrypted in transit (HTTPS), data encrypted at rest in AWS, JWT authentication, no passwords stored anywhere because there are no passwords (SMS only). We're not a bank — please don't treat the app like one.

If something goes wrong and your data is exposed, we'll let you know within a reasonable time and explain what happened.

---

## Changes to this policy

If we change anything material about how data is handled, we'll notify you in the app and by SMS before the change takes effect. Continuing to use the app means you accept the change.

---

## Contact

For privacy questions, text Dad. If you don't have his number, you probably shouldn't be on the app — but we can also be reached at the contact info posted on {{site}}.

---

*Your data is your data. We're just borrowing it to run the garage.*
