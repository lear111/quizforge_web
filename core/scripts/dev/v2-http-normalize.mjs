import assert from 'node:assert/strict';

export function normalize(record) {
  const headers = [];
  let body = record.body;
  for (let index = 0; index < record.headers.length; index += 2) {
    const name = record.headers[index];
    let value = record.headers[index + 1];
    if (name.toLowerCase() === 'date') {
      assert.ok(Number.isFinite(Date.parse(value)), record.label);
      value = '<date>';
    } else if (name.toLowerCase() === 'server-timing') {
      assert.match(value, /^[\w-]+;dur=\d+\.\d{3}(?:, [\w-]+;dur=\d+\.\d{3})*$/);
      value = value.replace(/dur=\d+\.\d{3}/g, 'dur=<ms>');
    } else if (
      record.label.startsWith('root') &&
      name.toLowerCase() === 'content-security-policy'
    ) {
      const nonce = /'nonce-([A-Za-z0-9+/]{24})'/.exec(value)?.[1];
      assert.ok(nonce, record.label);
      value = value.replaceAll(nonce, 'N'.repeat(24));
      if (record.method !== 'HEAD') {
        const html = Buffer.from(body, 'base64').toString('utf8');
        assert.equal(html.split(`nonce="${nonce}"`).length, 3);
        assert.ok(html.includes(`,${JSON.stringify(nonce)});`));
        body = Buffer.from(html.replaceAll(nonce, 'N'.repeat(24))).toString('base64');
      }
    }
    headers.push(name, value);
  }
  return { ...record, headers, body };
}
