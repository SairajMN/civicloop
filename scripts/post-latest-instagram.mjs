import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { CloudFormationClient, DescribeStacksCommand } = requireBackend('@aws-sdk/client-cloudformation');
const { DynamoDBClient } = requireBackend('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = requireBackend('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = requireBackend('@aws-sdk/client-s3');
const { getSignedUrl } = requireBackend('@aws-sdk/s3-request-presigner');

const raw = await readFile(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(raw.split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
}));
if (env.AWS_PROFILE) process.env.AWS_PROFILE = env.AWS_PROFILE;
process.env.AWS_REGION = env.AWS_REGION;
process.env.INSTAGRAM_SECRET_ID = env.INSTAGRAM_SECRET_ID;
if (!env.AWS_REGION || !env.INSTAGRAM_SECRET_ID) throw new Error('Set AWS_REGION and INSTAGRAM_SECRET_ID in .env and deploy first.');
const { publishInstagram, instagramCredentials } = await import('../backend/instagram.mjs');

const region = env.AWS_REGION;
const cloudformation = new CloudFormationClient({ region });
const stack = await cloudformation.send(new DescribeStacksCommand({ StackName: env.STACK_NAME || 'civicloop' }));
const outputs = Object.fromEntries((stack.Stacks?.[0]?.Outputs || []).map((item) => [item.OutputKey, item.OutputValue]));
const table = outputs.ReportsTableName;
const bucket = outputs.EvidenceBucketName;
if (!table || !bucket) throw new Error('Civicloop stack outputs are missing. Deploy the app first.');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

const reports = [];
let ExclusiveStartKey;
do {
  const page = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey, FilterExpression: 'sk = :report AND allowInstagram = :yes AND (#status = :open OR #status = :progress) AND attribute_not_exists(instagramStatus)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':report': 'REPORT', ':yes': true, ':open': 'open', ':progress': 'progress' }, Limit: 100 }));
  reports.push(...(page.Items || []));
  ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

const supported = (report) => (report.evidenceFiles || []).find((file) => ['image/jpeg', 'image/png', 'video/mp4'].includes(file.contentType));
const report = reports.filter(supported).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
if (!report) throw new Error('No unresolved report has both Instagram opt-in and supported photo/video evidence. Create an opted-in report first.');
const file = supported(report);
const preview = { id: report.id, title: report.title, city: report.city, createdAt: report.createdAt, evidence: file.fileName };
if (process.argv.includes('--preview')) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }

const credentials = await instagramCredentials();
const mediaUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: file.key }), { expiresIn: 3600 });
const caption = `Civicloop test post: ${String(report.title || 'Community report').slice(0, 100)}. A resident reported this issue near ${String(report.place || report.city).slice(0, 120)}, ${String(report.city).slice(0, 60)}. Report ${report.id}. This is a resident report awaiting independent verification.`.slice(0, 2200);
await db.send(new UpdateCommand({ TableName: table, Key: { pk: `REPORT#${report.id}`, sk: 'REPORT' }, UpdateExpression: 'SET instagramStatus = :publishing', ConditionExpression: 'allowInstagram = :yes AND attribute_not_exists(instagramStatus) AND (#status = :open OR #status = :progress)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':publishing': 'publishing', ':yes': true, ':open': 'open', ':progress': 'progress' } }));
console.log(`Publishing opted-in report ${report.id} to Instagram.`);
let published;
try { published = await publishInstagram({ ...credentials, mediaUrl, isVideo: file.contentType === 'video/mp4', caption }); }
catch (error) {
  await db.send(new UpdateCommand({ TableName: table, Key: { pk: `REPORT#${report.id}`, sk: 'REPORT' }, UpdateExpression: 'SET instagramStatus = :failed, instagramFailedAt = :at', ConditionExpression: 'instagramStatus = :publishing', ExpressionAttributeValues: { ':failed': 'failed', ':publishing': 'publishing', ':at': new Date().toISOString() } }));
  throw error;
}
await db.send(new UpdateCommand({ TableName: table, Key: { pk: `REPORT#${report.id}`, sk: 'REPORT' }, UpdateExpression: 'SET instagramStatus = :published, instagramMediaId = :mediaId, instagramPermalink = :permalink, instagramPublishedAt = :at', ConditionExpression: 'allowInstagram = :yes AND instagramStatus = :publishing', ExpressionAttributeValues: { ':published': 'published', ':publishing': 'publishing', ':mediaId': published.id, ':permalink': published.permalink, ':at': new Date().toISOString(), ':yes': true } }));
console.log(JSON.stringify({ reportId: report.id, instagramMediaId: published.id, permalink: published.permalink }));
