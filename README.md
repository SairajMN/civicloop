# Civicloop

Civicloop is a mobile-first neighborhood reporting app for environmental and public-space issues. Residents can pin a report, add photo/video evidence, follow nearby reports, and independently check whether a fix is visible. With the reporter's consent, the app previews and sends a report to the configured local contact; it labels test-inbox delivery distinctly.

## Included

- Responsive map and report feed for Bengaluru and Delhi, with a local-only demo mode.
- Reports can be pinned anywhere on the map. Bengaluru and Delhi are prefilled; for other places, enter the city or municipality so the report is grouped and routed correctly.
- Shared reports through API Gateway, Lambda, and DynamoDB.
- Cognito email/password sign-in using the hosted login page and OAuth authorization code with PKCE. New accounts are confirmed without sending an email; email addresses remain unverified.
- Private S3 evidence uploads using short-lived signed URLs. Files are limited to 25 MB and expire after one year.
- Bedrock Triage Agent with read-only tools for nearby-report matching and configured area/department lookup. It drafts the summary and authority email; if Bedrock is unavailable, the app identifies and uses a factual template instead.
- Bedrock Follow-up Agent that drafts a neutral update only after a report is unresolved for 24 hours. The app requires a person to review and share it.
- WardDesk Cognito group for authority status updates. A signed-in reporter can also send their own report after reviewing the recipient and message.
- SES report dispatch with JPEG/PNG/WebP attachments up to 5 MB. Video and larger evidence use a private link that expires after 24 hours.
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
2. Set `BEDROCK_MODEL_ID` to a direct model ID enabled for your project in that Region. If inference is unavailable, the app uses a clearly labeled factual template. Bedrock access is optional for deployment.
3. Verify `SES_FROM_EMAIL` in SES. Set `DEMO_INBOX_EMAIL` to a verified test recipient first. Configure `AUTHORITY_EMAILS_JSON` only with current, confirmed authority contacts; you can route by city or exact landmark/area. Example: `AUTHORITY_EMAILS_JSON='{"Bengaluru":{"department":"BBMP","areas":{"Mahadevapura":{"department":"BBMP Mahadevapura zone","email":"verified-contact@example.org"}}}}'`.
4. Run `node scripts/deploy.mjs`. If you use a named AWS profile, run `AWS_PROFILE=sai node scripts/deploy.mjs` (replace `sai` with your profile name). This creates or updates the AWS stack, writes the Cognito domain and public IDs to `.env` and `config.js`, and removes any Google identity provider from the Cognito user pool.
5. Create/sign in to a Cognito user, then add trusted desk operators to the `WardDesk` group in the Cognito console. Only that group can see the live ward desk; reporters can send only their own reports after reviewing the recipient and email.

The frontend receives only the API URL, Cognito domain, and public app client ID. The Cognito app client has no client secret. Email addresses are deliberately left unverified, so Cognito email-based password recovery cannot be used until users verify their address. `.env` is ignored by Git.

## Agent boundaries and follow-up

The Triage Agent summarizes the resident's text and may call only two read-only tools: nearby report search and configured area/department lookup. It does not visually analyze the uploaded photo or video. The Follow-up Agent can draft wording and a recommendation. Neither agent can change report status, send email, or post to social media. A configured `socialHandle` in the city's authority map is included in the draft when present. The server checks the 24-hour follow-up threshold; sharing opens the device share sheet only after the user chooses it. A reporter may send their report after previewing the configured recipient and message; WardDesk members may also dispatch or update report status. Each successful dispatch is recorded and subsequent sends are blocked to avoid duplicate email.

SES accounts in the sandbox can send only to verified recipients, so a newly configured city contact will not receive mail until SES production sending is enabled. A demo inbox is explicitly labeled in the preview and in report status. Do not treat a demo delivery as a municipal notification. Evidence stays in private S3 storage; email attachments are restricted to small JPEG/PNG/WebP images, while video and larger evidence use a 24-hour signed link.

Two distinct signed-in neighbors confirming a fix move the report to **Community verified**. Each user can contribute one check per report. Public report responses omit the reporter's Cognito identifier and private S3 key. Signed-in users can view attached evidence using an expiring download link.

## AWS resources

`template.yaml` defines the deployable stack. `backend/handler.mjs` implements the API and bounded Bedrock agent tools. `backend/auth-triggers.mjs` confirms email/password sign-ups without verifying the submitted email. `scripts/deploy.mjs` is the deployment entry point; deploying creates or updates AWS resources and can incur usage charges.

The browser's nearby notification feature is a reminder while the app is open and location is refreshed; it is not a background push service. Authority email and social sharing remain user-triggered. Add a scheduled notification provider or official social API only when the required sender/authority accounts and credentials are available.
