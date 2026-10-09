# Civicloop

Civicloop is a mobile-first neighborhood reporting app for environmental and public-space issues. Residents can pin a report, add photo/video evidence, follow nearby reports, and independently check whether a fix is visible. With the reporter's consent, the app previews and sends a report to the configured local contact; it labels test-inbox delivery distinctly.

## Included

- Responsive map and report feed for Bengaluru and Delhi, with a local-only demo mode.
- Reports can cover any location when the evidence has usable GPS metadata. Otherwise, the app uses the location the resident enables during capture. Bengaluru and Delhi are prefilled; other locations are grouped under Other.
- Shared reports through API Gateway, Lambda, and DynamoDB.
- Cognito email/password sign-in using the hosted login page and OAuth authorization code with PKCE. New accounts are confirmed without sending an email; email addresses remain unverified.
- Private S3 evidence uploads using short-lived signed URLs. Each report can include up to four photos or one video (25 MB per file); videos must be 15 seconds or shorter. Unsubmitted evidence expires after a day; submitted evidence expires after one year.
- Bedrock Vision Agent fills the issue category, title, details, and summary from compressed image previews. It samples up to three frames from a video because this flow sends images, not a native video input. Residents see capture, analysis, and read-only review steps before creating the report; if vision is unavailable, the app labels its cautious template draft.
- Image EXIF and common QuickTime GPS metadata take priority over the phone's live GPS. If evidence has no usable GPS, the report uses the live location; Bengaluru points are matched against the final 369 GBA ward polygons and five city corporations.
- The authenticated account can submit up to five reports per India-local day, including at most one video report.
- Bedrock Triage Agent drafts the authority email; if Bedrock is unavailable, the app identifies and uses a factual template instead.
- Bedrock Follow-up Agent that drafts a neutral update only after a report is unresolved for 24 hours. The app requires a person to review and share it.
- WardDesk Cognito group for authority status updates. A signed-in reporter can also send their own report after reviewing the recipient and message.
- Report dispatch through Yahoo SMTP (when configured) or SES, with small photos attached. Video and larger evidence use private links that expire after 24 hours.
- A time-limited single-use authority link accepts a repair photo and GPS within 500 metres of the report. The repair photo is available to signed-in neighbors, who still verify the fix in the app.
- An hourly scheduled check resends the report after three days if it remains unresolved, with the same evidence and a renewed authority link.
- CloudFront-hosted web assets and 30-day Lambda log retention.

## Run the local demo

Open `index.html`, or serve the project so browser location and OAuth callbacks have an origin:

```sh
python3 -m http.server 8080
```

Visit `http://localhost:8080`. With an empty `config.js`, the map and sample reports are available locally. AI report creation needs the deployed AWS backend and sign-in.

## Deploy to AWS

The stack uses regional API Gateway, Lambda, Cognito, DynamoDB, S3, Bedrock, and SES resources, plus CloudFront for static hosting. All regional resources must use the Region assigned to your AWS project. Confirm it in **AWS Settings → View all projects → Overview → Additional Info → Region**. Check the selected Region in `~/.aws/config` if it is unclear.

Before deployment, confirm the Free plan state and supported-service list for this AWS experience. API Gateway, Bedrock, CloudFront, Cognito, DynamoDB, SES, S3, and Lambda are listed for the Free Tier, but Bedrock cross-Region inference is not supported. Use a model available directly in your selected Region. Service use can consume credits; model inference and data transfer have usage costs. Review AWS Settings → Billing and the AWS Billing and Cost Management console before and after deploying.

Requirements: Node.js 22+, AWS CLI authenticated with your AWS profile/SSO, and AWS SAM CLI. No static AWS access keys belong in `.env`.

1. Copy `.env.example` to `.env` and set `AWS_REGION` to your selected Region.
2. Set `BEDROCK_MODEL_ID` to a direct model ID enabled for your project in that Region. If inference is unavailable, the app uses a clearly labeled factual template. Bedrock access is optional for deployment.
3. Set `SES_FROM_EMAIL` to `civicloop@yahoo.com` and `DEMO_INBOX_EMAIL` to a test recipient. To send through Yahoo, [create a Yahoo app password](https://help.yahoo.com/kb/technical-support/generate-password-access-yahoo-mail-sln15241.html), then create an AWS Secrets Manager secret named `civicloop/yahoo-smtp` with this SecretString JSON: `{"username":"civicloop@yahoo.com","appPassword":"<Yahoo app password>"}`. Set `YAHOO_SMTP_SECRET_ID=civicloop/yahoo-smtp`; the app password stays in Secrets Manager and is resolved into the Lambda environment during deployment. Yahoo's authenticated SMTP path is preferred for a Yahoo From address. If the secret ID is blank, the app uses SES, which requires authenticated sender-domain setup for reliable Gmail delivery. Configure `AUTHORITY_EMAILS_JSON` only with current, verified ward contacts. Bengaluru entries use GBA ward numbers, for example `{"Bengaluru":{"wards":{"25":{"department":"Bengaluru West City Corporation","email":"verified-contact@example.org"}}}}`. Until a ward email is configured, the app labels and uses the demo inbox; it does not infer an email address from the map.
4. Run `node scripts/deploy.mjs`. If you use a named AWS profile, run `AWS_PROFILE=sai node scripts/deploy.mjs` (replace `sai` with your profile name). This creates or updates the AWS stack, writes the Cognito domain and public IDs to `.env` and `config.js`, and removes any Google identity provider from the Cognito user pool.
5. Create/sign in to a Cognito user, then add trusted desk operators to the `WardDesk` group in the Cognito console. Only that group can see the live ward desk; reporters can send only their own reports after reviewing the recipient and email.

The frontend receives only the API URL, Cognito domain, and public app client ID. The Cognito app client has no client secret. Email addresses are deliberately left unverified, so Cognito email-based password recovery cannot be used until users verify their address. `.env` is ignored by Git.

## Agent boundaries and follow-up

The Vision Agent suggests issue fields from image evidence and sampled video frames; it cannot send email or change records. The Triage Agent drafts the authority email. The Follow-up Agent drafts a neutral update, but does not publish to social media. A reporter may send a report only after reviewing the configured recipient and message. Each initial dispatch is recorded and blocked from duplicate sends; the scheduled three-day reminder is the only automatic resend.

SES accounts in the sandbox can send only to verified recipients, so a newly configured city contact will not receive mail until SES production sending is enabled. A demo inbox is explicitly labeled in the preview and in report status. Do not treat a demo delivery as a municipal notification. Evidence stays in private S3 storage; small JPEG/PNG/WebP photos are attached, while video and larger evidence use a 24-hour signed link.

Two distinct signed-in neighbors confirming a fix move the report to **Community verified**. Each user can contribute one check per report. Public report responses omit the reporter's Cognito identifier and private S3 key. Signed-in users can view attached evidence using an expiring download link.

## AWS resources

`template.yaml` defines the deployable stack. `backend/handler.mjs` implements the API and bounded Bedrock agent tools. `backend/auth-triggers.mjs` confirms email/password sign-ups without verifying the submitted email. `scripts/deploy.mjs` is the deployment entry point; deploying creates or updates AWS resources and can incur usage charges.

Nearby issue alerts use foreground browser location and notifications while Civicloop is open; mobile browsers do not reliably run GPS in the background. Social posting remains out of scope and user-triggered sharing is still a share-sheet draft. Bengaluru polygons are attributed to the Greater Bengaluru Authority and OpenCity/Oorvani Foundation; see `backend/data/README.md` for the ODbL source and limits. Delhi ward polygons and verified ward contacts are not included yet.
