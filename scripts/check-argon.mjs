import fs from 'node:fs';
try {
  process.loadEnvFile('.env');
} catch {}
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('No local API key configured');
  process.exit(1);
}
const started = Date.now();
try {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model: 'gemini-4-argon',
      input: 'Reply with exactly ARGON_READY. This is a connectivity check.',
      generation_config: { thinking_level: 'low', max_output_tokens: 256 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  const safe = JSON.stringify(data).split(key).join('[REDACTED]');
  fs.mkdirSync('runtime', { recursive: true });
  fs.writeFileSync('runtime/argon-probe.json', safe);
  console.log(
    JSON.stringify(
      { status: response.status, elapsedMs: Date.now() - started, response: JSON.parse(safe) },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(String(e).split(key).join('[REDACTED]'));
  process.exit(1);
}
