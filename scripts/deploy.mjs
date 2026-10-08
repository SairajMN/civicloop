import { chmod, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const envPath = new URL('../.env', import.meta.url);
let text;
try { text = await readFile(envPath, 'utf8'); } catch { throw new Error('Copy .env.example to .env, set AWS_REGION, then sign in with your AWS CLI/SSO profile.'); }
const env = Object.fromEntries(text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
  const at = line.indexOf('=');
  return at < 0 ? [line.trim(), ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
}));
const region = env.AWS_REGION;
const stack = env.STACK_NAME || 'civicloop';
if (!region || region.includes('your-selected')) throw new Error('Set AWS_REGION to the selected Region shown in AWS Settings > View all projects > Overview > Additional Info > Region.');
if (/^(global|us|eu|apac)\./.test(env.BEDROCK_MODEL_ID || '')) throw new Error('The AWS Free plan for this experience does not support cross-Region Bedrock inference; set a direct model ID available in the selected Region.');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} failed.`);
  return result.stdout;
}

console.log('Building Civicloop with AWS SAM...');
run('npm', ['install', '--prefix', 'backend', '--omit=dev']);
run('sam', ['build', '--template-file', 'template.yaml']);
const params = [
  `BedrockModelId=${env.BEDROCK_MODEL_ID || ''}`,
  `SesFromEmail=${env.SES_FROM_EMAIL || ''}`,
  `DemoInboxEmail=${env.DEMO_INBOX_EMAIL || ''}`,
  `AuthorityEmailsJson=${env.AUTHORITY_EMAILS_JSON || '{}'}`,
];
run('sam', ['deploy', '--stack-name', stack, '--region', region, '--capabilities', 'CAPABILITY_IAM', '--resolve-s3', '--no-confirm-changeset', '--no-fail-on-empty-changeset', '--parameter-overrides', ...params]);

const stacks = JSON.parse(run('aws', ['cloudformation', 'describe-stacks', '--stack-name', stack, '--region', region, '--output', 'json'], { capture: true }));
const outputs = Object.fromEntries(stacks.Stacks[0].Outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
const updates = { API_BASE_URL: outputs.ApiUrl, COGNITO_USER_POOL_ID: outputs.UserPoolId, COGNITO_APP_CLIENT_ID: outputs.AppClientId, COGNITO_DOMAIN: outputs.CognitoDomain, MEDIA_BUCKET_NAME: outputs.EvidenceBucketName };
const lines = text.split(/\r?\n/).filter((line) => !Object.keys(updates).some((key) => line.startsWith(`${key}=`)));
lines.push(...Object.entries(updates).map(([key, value]) => `${key}=${value}`));
await writeFile(envPath, `${lines.join('\n')}\n`, { mode: 0o600 });
await chmod(envPath, 0o600);
const publicConfig = { apiBaseUrl: outputs.ApiUrl, cognitoDomain: outputs.CognitoDomain, cognitoClientId: outputs.AppClientId };
await writeFile(new URL('../config.js', import.meta.url), `window.CIVICLOOP_CONFIG = ${JSON.stringify(publicConfig)};\n`, { mode: 0o644 });

if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && !env.GOOGLE_OAUTH_CLIENT_ID.startsWith('your_') && !env.GOOGLE_OAUTH_CLIENT_SECRET.startsWith('replace_')) run('node', ['backend/configure-google.mjs']);
for (const file of ['index.html', 'styles.css', 'app.js', 'auth.js', 'config.js']) run('aws', ['s3', 'cp', file, `s3://${outputs.WebBucketName}/${file}`, '--region', region]);
run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', outputs.WebDistributionId, '--paths', '/*']);
console.log(`Civicloop is deployed at ${outputs.WebUrl}`);
