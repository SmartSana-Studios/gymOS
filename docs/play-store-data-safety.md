# Play Console Data Safety Form — GymOS (Android)

Answers for Play Console → Policy → App content → Data safety, grounded in
the actual schema (`supabase/migrations/`) and `apps/mobile/app.json`
permissions — not generic boilerplate. Re-derive this if the schema or
permissions change; don't hand-edit Play Console without updating this file
to match.

## Does your app collect or share any of the required user data types?

**Yes.**

## Data types collected

### Personal info
| Type | Collected? | Shared with third parties? | Purpose |
|---|---|---|---|
| Name | Yes (`members.name`) | No | App functionality (member identification) |
| Phone number | Yes (`members.phone`, `users.phone`) | No | Account management (OTP login), app functionality |
| Email address | Yes, optional (`members.email`) | No | App functionality |
| Date of birth | Yes, optional (`members.dob`) | No | App functionality |
| Other info (emergency contact) | Yes, optional (`members.emergency_contact`) | No | App functionality (safety) |

### Photos
| Type | Collected? | Shared? | Purpose |
|---|---|---|---|
| Photos | Yes (`members.photo_url`, `users.photo_url` — profile pictures) | No | App functionality |

### Financial info
| Type | Collected? | Shared? | Purpose |
|---|---|---|---|
| Purchase history | Yes (`payments`: amount, currency, method, status) | Yes — payment processor (Notch Pay) to process the transaction | App functionality |

Note: **no raw card/payment-instrument numbers are stored** — `payments.provider_transaction_ref` only; card data is handled entirely by the Notch Pay processor, never touches GymOS's database.

### App activity
| Type | Collected? | Shared? | Purpose |
|---|---|---|---|
| App interactions (check-in/check-out timestamps) | Yes (`attendance_events`) | No | App functionality (attendance tracking) |
| Other user-generated content (coach session notes) | Yes (`session_notes`) | No | App functionality (coach-member interaction) |

### Device or other IDs
| Type | Collected? | Shared? | Purpose |
|---|---|---|---|
| Device or other IDs | Yes (`device_push_tokens.expo_push_token`) | Yes — Expo's push notification service, to deliver notifications | App functionality |

## Data types explicitly NOT collected
- **Location** (no GPS/location permission requested anywhere in `app.json`)
- **Health and fitness** — `members.goal`/`experience_level` are free-text onboarding fields (e.g. "lose weight", "beginner"), not health data in Play's clinical sense; if this changes (e.g. adding weight/body metrics), this section needs revisiting
- **Web browsing history, search history, contacts, calendar**
- **Audio/voice recordings** — confirmed no microphone usage in code (see `apps/mobile` — `RECORD_AUDIO` permission was removed as unused)
- **Messages** (SMS/MMS content — OTP delivery uses Twilio server-side, the app itself never reads/sends SMS)

## Security practices
- Data encrypted in transit: **Yes** (HTTPS/TLS to Supabase)
- Users can request data deletion: **Yes/No — needs a decision.** No in-app "delete my account" flow exists yet (only owner/manager can deactivate a member via `members.deactivated_at`, which is a soft-delete, not erasure). If you want to declare "Yes" here, either build a real deletion flow or handle deletion requests manually via support contact — Play Console lets you satisfy this with a documented manual process instead of an in-app button, but you must provide instructions.

## Still needed before this form can be submitted
1. A live **privacy policy URL** (draft is in `docs/privacy-policy.md` — needs review + hosting)
2. A decision on the data-deletion question above
3. Confirm with whoever manages the Notch Pay relationship whether their DPA/data-sharing terms need to be referenced explicitly
