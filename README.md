# Civicloop

Civicloop is a mobile-first neighborhood reporting app for public-space and environmental issues. Residents can report a problem with a map pin and photo/video, follow shared reports, and confirm whether a repair is complete. A restricted ward desk can update status and send a reviewed email to the configured municipal contact.

## Included

- Responsive map and report feed for Bengaluru and Delhi, with a local-only demo mode.
- Shared reports through API Gateway, Lambda, and DynamoDB.
- Cognito email/password sign-in using the hosted login page and OAuth authorization code with PKCE. New accounts are confirmed without sending an email; email addresses remain unverified.
- Private S3 evidence uploads using short-lived signed URLs. Files are limited to 25 MB and expire after one year.
- Bedrock Triage Agent with read-only tools for nearby-report matching and configured area/department lookup.
- Bedrock Follow-up Agent that drafts a neutral update only after a report is unresolved for 24 hours. The app requires a person to review and share it.
- WardDesk Cognito group for authority status updates and manually confirmed SES email.
- CloudFront-hosted web assets and 30-day Lambda log retention.

## Run the local demo

Open `index.html`, or serve the project so browser location and OAuth callbacks have an origin:

```sh
python3 -m http.server 8080
```

Visit `http://localhost:8080`. With the empty `config.js`, reports stay in that browser and the draft helper is a local template. No credentials are needed for this mode.

## Deploy to AWS

The stack uses regional API Gateway, Lambda, Cognito, DynamoDB, S3, Bedrock, and SES resources, plus CloudFront for static hosting. All regional resources must use the Region assigned to your AWS project. Confirm it in **AWS Settings → View all projects → Overview → Additional Info → Region**. Check the selected Region in `~/.aws/config` if it is unclear.

Before deployment, confirm the Free plan state and supported-service list for this AWS experience. API Gateway, Bedrock, CloudFront, Cognito, DynamoDB, SES, S3, and Lambda are listed for the Free Tier, but Bedrock cross-Region inference is not supported. Use a model available directly in your selected Region. Service use can consume credits; model inference and data transfer have usage costs. Review AWS Settings → Billing and the AWS Billing and Cost Management console before and after deploying.

Requirements: Node.js 22+, AWS CLI authenticated with your AWS profile/SSO, and AWS SAM CLI. No static AWS access keys belong in `.env`.

1. Copy `.env.example` to `.env` and set `AWS_REGION` to your selected Region.
2. Set `BEDROCK_MODEL_ID` to a direct model ID enabled in that Region. Leave it empty to deploy without Bedrock inference; deterministic draft text is used instead.
3. If you want authority email, verify `SES_FROM_EMAIL` with SES first. Set `DEMO_INBOX_EMAIL` for a safe test recipient and replace the sample authority map only with contacts you have confirmed. Keep the JSON value single-quoted in `.env`, for example: `AUTHORITY_EMAILS_JSON='{"Bengaluru":{"department":"BBMP","email":"ward@example.org"}}'`.
4. Run `node scripts/deploy.mjs`. If you use a named AWS profile, run `AWS_PROFILE=sai node scripts/deploy.mjs` (replace `sai` with your profile name). This creates or updates the AWS stack, writes the Cognito domain and public IDs to `.env` and `config.js`, and removes any Google identity provider from the Cognito user pool.
5. Create/sign in to a Cognito user, then add trusted desk operators to the `WardDesk` group in the Cognito console. Only that group can see the live ward desk and send emails.

The frontend receives only the API URL, Cognito domain, and public app client ID. The Cognito app client has no client secret. Email addresses are deliberately left unverified, so Cognito email-based password recovery cannot be used until users verify their address. `.env` is ignored by Git.

## Agent boundaries and follow-up

The Triage Agent summarizes the resident's text and may call only two read-only tools: nearby report search and configured area/department lookup. It does not visually analyze the uploaded photo or video. The Follow-up Agent can draft wording and a recommendation. Neither agent can change report status, send email, or post to social media. A configured `socialHandle` in the city's authority map is included in the draft when present. The server checks the 24-hour follow-up threshold; sharing opens the device share sheet only after the user chooses it. Email is restricted to the WardDesk group, previews the recipient and report details for confirmation, and sends only to the configured city contact or explicit test inbox.

Two distinct signed-in neighbors confirming a fix move the report to **Community verified**. Each user can contribute one check per report. Public report responses omit the reporter's Cognito identifier and private S3 key. Signed-in users can view attached evidence using an expiring download link.

## AWS resources

`template.yaml` defines the deployable stack. `backend/handler.mjs` implements the API and bounded Bedrock agent tools. `backend/auth-triggers.mjs` confirms email/password sign-ups without verifying the submitted email. `scripts/deploy.mjs` is the deployment entry point. No AWS resources have been created by committing this project.

The browser's nearby notification feature is a reminder while the app is open and location is refreshed; it is not a background push service. Authority email and social sharing remain user-triggered. Add a scheduled notification provider or official social API only when the required sender/authority accounts and credentials are available.
