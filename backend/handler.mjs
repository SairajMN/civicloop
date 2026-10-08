import { randomUUID } from 'node:crypto';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });
const bedrock = new BedrockRuntimeClient({ region });
const ses = new SESv2Client({ region });
const table = process.env.REPORTS_TABLE;
const bucket = process.env.EVIDENCE_BUCKET;
const modelId = process.env.BEDROCK_MODEL_ID;
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': process.env.APP_ORIGIN || '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const fail = (statusCode, message) => json(statusCode, { error: message });
const now = () => new Date().toISOString();
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const idPart = (id) => clean(decodeURIComponent(id), 80);
const groups = (event) => event.requestContext?.authorizer?.jwt?.claims?.['cognito:groups'] || '';
const isWard = (event) => String(groups(event)).split(/[\s,\[\]]+/).includes('WardDesk');
const authorityMap = () => { try { return JSON.parse(process.env.AUTHORITY_EMAILS_JSON || '{}'); } catch { return {}; } };
const reportKey = (id) => ({ pk: `REPORT#${id}`, sk: 'REPORT' });

async function listReports(city) {
  const result = await db.send(new QueryCommand({ TableName: table, IndexName: 'city-createdAt-index', KeyConditionExpression: 'city = :city', ExpressionAttributeValues: { ':city': clean(city, 60) }, ScanIndexForward: false, Limit: 100 }));
  return (result.Items || []).map(publicReport);
}

function publicReport(item) {
  const { id, city, category, title, details, lat, lng, status, createdAt, updatedAt, verifiedAt, checks, fixChecks, photoName, place, summary, authorityEmailedAt } = item;
  return { id, city, category, title, details, lat, lng, status, createdAt, updatedAt, verifiedAt, checks, fixChecks, photoName, place, summary, authorityEmailedAt };
}

async function getReport(id) {
  const result = await db.send(new GetCommand({ TableName: table, Key: reportKey(id) }));
  return result.Item;
}

async function nearbyReports(city, lat, lng) {
  const items = await listReports(city);
  return items.filter((item) => item.status !== 'verified' && item.lat && item.lng && Math.hypot((item.lat - lat) * 111, (item.lng - lng) * 85) <= 1.2).slice(0, 5).map(({ id, category, title, status }) => ({ id, category, title, status }));
}

const agentTools = [
  { toolSpec: { name: 'find_nearby_reports', description: 'Find open reports within roughly 1.2 km to help detect a possible duplicate.', inputSchema: { json: { type: 'object', properties: { city: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['city', 'lat', 'lng'] } } } },
  { toolSpec: { name: 'lookup_area_authority', description: 'Look up the configured municipal contact for a city and issue category. Return configured data only.', inputSchema: { json: { type: 'object', properties: { city: { type: 'string' }, category: { type: 'string' } }, required: ['city', 'category'] } } } },
];

async function runTriageAgent(report) {
  if (!modelId) return { summary: `${report.category}: ${report.title}. ${report.details}`, urgency: 'standard', department: 'Municipal field team', duplicateCandidates: [], note: 'Local fallback draft; configure BEDROCK_MODEL_ID to enable the Bedrock agent.' };
  let messages = [{ role: 'user', content: [{ text: JSON.stringify({ task: 'Prepare a concise civic report triage. Do not make claims beyond the resident evidence. Use the two tools when useful. Return JSON with summary, urgency (standard or urgent), department, duplicateCandidates (array), and authority (configured department/contact only). Do not send anything or change status.', report: { city: report.city, category: report.category, title: report.title, details: report.details, lat: report.lat, lng: report.lng } })] }];
  for (let turn = 0; turn < 4; turn += 1) {
    const result = await bedrock.send(new ConverseCommand({ modelId, system: [{ text: 'You are Civicloop Triage Agent. Be factual, concise, privacy-aware, and never infer blame or claim an issue is verified. Tool use is limited to read-only report and authority lookups. Never send email, post, or change records.' }], messages, toolConfig: { tools: agentTools }, inferenceConfig: { maxTokens: 500, temperature: 0.2 } }));
    messages = [...messages, result.output.message];
    if (result.stopReason !== 'tool_use') {
      const text = result.output.message.content.find((part) => part.text)?.text || '{}';
      try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); } catch { return { summary: text.slice(0, 600), urgency: 'standard', department: 'Municipal field team', duplicateCandidates: [] }; }
    }
    const results = [];
    for (const part of result.output.message.content) if (part.toolUse) {
      const { name, input } = part.toolUse;
      let content;
      if (name === 'find_nearby_reports' && Number.isFinite(input.lat) && Number.isFinite(input.lng)) content = await nearbyReports(input.city, input.lat, input.lng);
      else if (name === 'lookup_area_authority') content = authorityMap()[clean(input.city, 60)] || { department: clean(input.category, 80), emailConfigured: false };
      else content = { error: 'Tool is unavailable' };
      results.push({ toolResult: { toolUseId: part.toolUse.toolUseId, content: [{ json: content }], status: 'success' } });
    }
    messages = [...messages, { role: 'user', content: results }];
  }
  return { summary: `${report.category}: ${report.title}. ${report.details}`, urgency: 'standard', department: 'Municipal field team', duplicateCandidates: [], note: 'Agent reached its tool-use limit; review the report manually.' };
}

async function runFollowUpAgent(report) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(report.createdAt)) / 3600000);
  const eligible = ageHours >= 24 && report.status !== 'verified';
  const evidence = { ageHours: Math.floor(ageHours), status: report.status, communityChecks: report.checks || 0, fixChecks: report.fixChecks || 0, eligibleForFollowUp: eligible };
  if (!eligible) return { ...evidence, recommendation: report.status === 'verified' ? 'The community has verified this report; no escalation draft is needed.' : 'Wait until this unresolved report has been open for at least 24 hours.', shareDraft: '' };
  const socialHandle = clean(authorityMap()[report.city]?.socialHandle, 80);
  if (!modelId) return { ...evidence, recommendation: 'Ask a nearby resident to verify the location.', shareDraft: `${report.title} · ${report.city}. Status: ${report.status}. ${report.checks || 0} community check(s). Please review the current situation.${socialHandle ? ` ${socialHandle}` : ''}` };
  const result = await bedrock.send(new ConverseCommand({ modelId, system: [{ text: 'You are Civicloop Follow-up Agent. Only prepare a neutral draft and next-step suggestion; never send email, post to social media, change report status, or claim an authority failed. Output JSON with recommendation and shareDraft. Do not include personal details.' }], messages: [{ role: 'user', content: [{ text: JSON.stringify({ report: { city: report.city, category: report.category, title: report.title, status: report.status }, evidence, configuredAuthorityHandle: socialHandle || null, task: 'Prepare a short neutral follow-up draft. If a configured authority handle exists, include it exactly. If the report is younger than 24 hours or community-verified, recommend no escalation. Use factual wording.' })] }], inferenceConfig: { maxTokens: 250, temperature: 0.2 } }));
  const text = result.output.message.content.find((part) => part.text)?.text || '{}';
  try {
    const draft = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    if (socialHandle && !String(draft.shareDraft || '').includes(socialHandle)) draft.shareDraft = `${draft.shareDraft || report.title} ${socialHandle}`;
    return { ...evidence, ...draft };
  } catch { return { ...evidence, recommendation: 'Review this report manually.', shareDraft: `${text.slice(0, 400)}${socialHandle ? ` ${socialHandle}` : ''}` }; }
}

async function handle(event) {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || '/';
  if (method === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const user = claims?.sub;
  const body = event.body ? JSON.parse(event.body) : {};

  if (method === 'GET' && path === '/authority') {
    if (!user || !isWard(event)) return fail(403, 'Ward desk role is required to view authority routing.');
    const city = clean(event.queryStringParameters?.city, 60);
    const authority = authorityMap()[city] || {};
    const email = clean(authority.email || process.env.DEMO_INBOX_EMAIL, 254);
    return json(200, { city, department: clean(authority.department, 100) || 'Municipal field team', email, testRecipient: !authority.email, canSend: Boolean(email.includes('@') && process.env.SES_FROM_EMAIL?.includes('@')) });
  }

  if (method === 'GET' && path === '/reports') return json(200, { reports: await listReports(event.queryStringParameters?.city || 'Bengaluru') });
  if (method === 'POST' && path === '/agent/triage') {
    if (!user) return fail(401, 'Sign in to continue.');
    const report = { city: clean(body.city, 60), category: clean(body.category, 80), title: clean(body.title, 100), details: clean(body.details, 800), lat: Number(body.lat), lng: Number(body.lng) };
    if (!report.city || !report.category || !report.title || !report.details || !Number.isFinite(report.lat) || !Number.isFinite(report.lng)) return fail(400, 'Add report details and location before asking for a draft.');
    return json(200, { draft: await runTriageAgent(report) });
  }
  const publicDetail = path.match(/^\/reports\/([^/]+)$/);
  if (method === 'GET' && publicDetail) {
    const report = await getReport(idPart(publicDetail[1]));
    return report ? json(200, { report: publicReport(report) }) : fail(404, 'Report not found.');
  }
  if (!user) return fail(401, 'Sign in to continue.');

  if (method === 'POST' && path === '/reports') {
    const report = { id: randomUUID(), city: clean(body.city, 60), category: clean(body.category, 80), title: clean(body.title, 100), details: clean(body.details, 800), summary: clean(body.summary, 800), lat: Number(body.lat), lng: Number(body.lng), status: 'open', createdAt: now(), checks: 0, fixChecks: 0, ownerSub: user, place: clean(body.place, 120) || 'Pinned location' };
    if (!report.city || !report.category || !report.title || !report.details || !Number.isFinite(report.lat) || !Number.isFinite(report.lng) || Math.abs(report.lat) > 90 || Math.abs(report.lng) > 180) return fail(400, 'Add a category, title, details, and valid map location.');
    await db.send(new PutCommand({ TableName: table, Item: { ...report, pk: `REPORT#${report.id}`, sk: 'REPORT', city: report.city } }));
    return json(201, { report });
  }

  const match = path.match(/^\/reports\/([^/]+)(?:\/(check|ai|upload|evidence|dispatch|status))?$/);
  if (!match) return fail(404, 'Route not found.');
  const id = idPart(match[1]);
  const action = match[2];
  const report = await getReport(id);
  if (!report) return fail(404, 'Report not found.');

  if (method === 'POST' && action === 'check') {
    const kind = clean(body.kind, 20);
    if (!['still', 'fixed', 'unsure'].includes(kind)) return fail(400, 'Choose still, fixed, or unsure.');
    if (kind === 'unsure') return json(200, { report, recorded: false });
    const check = { pk: `REPORT#${id}`, sk: `CHECK#${user}`, kind, createdAt: now() };
    const update = { TableName: table, Key: reportKey(id), UpdateExpression: kind === 'fixed' ? 'ADD checks :one, fixChecks :one' : 'ADD checks :one', ExpressionAttributeValues: { ':one': 1 } };
    try {
      await db.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: table, Item: check, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Update: update },
      ] }));
    } catch (error) { if (error.name === 'TransactionCanceledException') return fail(409, 'You have already checked this report.'); throw error; }
    const updated = await getReport(id);
    if ((updated.fixChecks || 0) >= 2 && updated.status !== 'verified') await db.send(new UpdateCommand({ TableName: table, Key: reportKey(id), UpdateExpression: 'SET #status = :status, verifiedAt = :at', ConditionExpression: 'fixChecks >= :two', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':status': 'verified', ':at': now(), ':two': 2 } }));
    return json(200, { report: await getReport(id), recorded: true });
  }

  if (method === 'POST' && action === 'ai') {
    if (report.ownerSub !== user && !isWard(event)) return fail(403, 'Only the reporter or ward desk can request triage.');
    return json(200, { draft: body.task === 'follow-up' ? await runFollowUpAgent(report) : await runTriageAgent(report) });
  }

  if (method === 'POST' && action === 'upload') {
    if (report.ownerSub !== user) return fail(403, 'Only the reporter can attach evidence.');
    const name = clean(body.fileName, 180).replace(/[^a-zA-Z0-9._-]/g, '_');
    const type = clean(body.contentType, 100);
    const size = Number(body.size);
    if (!name || !/^(image|video)\//.test(type) || !Number.isFinite(size) || size < 1 || size > 25 * 1024 * 1024) return fail(400, 'Evidence must be an image or video under 25 MB.');
    const key = `reports/${id}/${randomUUID()}-${name}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: type }), { expiresIn: 300 });
    return json(200, { uploadUrl: url, evidenceKey: key, expiresIn: 300 });
  }

  if (method === 'POST' && action === 'evidence') {
    if (report.ownerSub !== user) return fail(403, 'Only the reporter can attach evidence.');
    const key = clean(body.evidenceKey, 500);
    if (!key.startsWith(`reports/${id}/`)) return fail(400, 'Evidence key does not belong to this report.');
    const metadata = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (!metadata.ContentType?.match(/^(image|video)\//) || (metadata.ContentLength || 0) > 25 * 1024 * 1024) return fail(400, 'Evidence must be an image or video under 25 MB.');
    await db.send(new UpdateCommand({ TableName: table, Key: reportKey(id), UpdateExpression: 'SET evidenceKey = :key, photoName = :name', ExpressionAttributeValues: { ':key': key, ':name': clean(body.fileName, 180) } }));
    return json(200, { attached: true });
  }

  if (method === 'GET' && action === 'evidence') {
    if (!report.evidenceKey) return fail(404, 'No evidence is attached to this report.');
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: report.evidenceKey }), { expiresIn: 300 });
    return json(200, { url, expiresIn: 300 });
  }

  if (method === 'POST' && action === 'dispatch') {
    if (!isWard(event)) return fail(403, 'Ward desk role is required to send authority email.');
    const authority = authorityMap()[report.city] || {};
    const recipient = clean(authority.email || process.env.DEMO_INBOX_EMAIL, 254);
    if (!recipient.includes('@') || !process.env.SES_FROM_EMAIL) return fail(400, 'Configure a verified sender and city authority email first.');
    const subject = clean(`Civicloop ${report.id}: ${report.title}`, 180);
    const evidenceUrl = report.evidenceKey ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: report.evidenceKey }), { expiresIn: 86400 }) : '';
    const text = `${report.summary || report.details}\n\nCategory: ${report.category}\nLocation: ${report.lat}, ${report.lng}\nReport: ${report.id}${evidenceUrl ? `\nEvidence (private link, expires in 24 hours): ${evidenceUrl}` : ''}\n\nThis message was reviewed and sent by a ward desk user.`;
    await ses.send(new SendEmailCommand({ FromEmailAddress: process.env.SES_FROM_EMAIL, Destination: { ToAddresses: [recipient] }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } } }));
    await db.send(new UpdateCommand({ TableName: table, Key: reportKey(id), UpdateExpression: 'SET #status = :status, authorityEmailedAt = :at, authorityEmail = :to', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':status': 'progress', ':at': now(), ':to': recipient } }));
    return json(200, { sent: true, to: recipient });
  }

  if (method === 'POST' && action === 'status') {
    if (!isWard(event)) return fail(403, 'Ward desk role is required to update authority status.');
    const status = clean(body.status, 20);
    if (!['progress', 'claimed', 'open'].includes(status)) return fail(400, 'Invalid status.');
    await db.send(new UpdateCommand({ TableName: table, Key: reportKey(id), UpdateExpression: 'SET #status = :status, updatedAt = :at', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':status': status, ':at': now() } }));
    return json(200, { report: await getReport(id) });
  }
  return fail(404, 'Route not found.');
}

export const handler = async (event) => {
  try { return await handle(event); }
  catch (error) {
    console.error(JSON.stringify({ name: error.name, message: error.message, requestId: event.requestContext?.requestId }));
    return fail(500, 'The service could not complete that request. Try again shortly.');
  }
};
