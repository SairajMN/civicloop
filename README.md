# Civicloop

A mobile-first environmental issue reporting prototype. Residents can browse a neighborhood map, file a report, add follow-up evidence, and verify whether an issue is fixed. A ward desk demo shows how reports could be triaged.

## Run locally

Open `index.html` in a browser, or serve this folder with any static file server. The map uses Leaflet and OpenStreetMap tiles from public CDNs, so the map needs an internet connection.

This is a front-end prototype: reports and preferences are stored in this browser's `localStorage`. Media is previewed but not uploaded. Other people and devices do not see local demo reports. Bedrock summaries, shared report storage, real push notifications, Google sign-in, and authority email delivery are not connected yet.

## AWS configuration for the next integration step

Copy `.env.example` to `.env` when the AWS backend is ready. The current static prototype does not read environment files.

- `AWS_REGION`: your AWS project's selected Region. Confirm it in **AWS Settings → View all projects → Overview → Additional Info → Region** before creating regional resources.
- `API_BASE_URL`: HTTPS URL for the app API.
- `COGNITO_USER_POOL_ID` and `COGNITO_APP_CLIENT_ID`: public identifiers for sign-in; use a public app client with no client secret.
- `GOOGLE_OAUTH_CLIENT_ID`: optional Google identity provider client ID. Never put a Google client secret in browser code.
- `BEDROCK_MODEL_ID`, `MEDIA_BUCKET_NAME`, `SES_FROM_EMAIL`, and `DEMO_INBOX_EMAIL`: server-side settings for AI drafts, private evidence storage, and test email delivery.

Do not add AWS access keys, Google client secrets, or other secrets to this file. Use an AWS CLI profile locally and an IAM role for deployed backend code. Keep `.env` private; `.env.example` is safe to commit.

## Demo flow

1. Browse the sample reports on the map.
2. Open **Report an issue**, add a category, details, optional photo or video, and location.
3. Open a report to add a community check: still there, looks fixed, or can't verify.
4. Use **Ward desk** to acknowledge a report or claim a fix.
5. Share a neutral follow-up using the device share sheet. Sharing always requires a user action.

The report form's draft helper is a local demo template, not a live AI result. The status and map data are sample data and must not be treated as official authority records.
