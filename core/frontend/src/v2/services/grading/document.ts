const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
// getRandomValues also works on the HTTP LAN pages used by phones.
export const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');

export function nonceAttribute(nonce: string): string {
  return nonce.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function workerDocument(source: string): string {
  const workerSource = `
    let grader;
    const QF = Object.freeze({grader: Object.freeze({register(value) { grader = value; }})});
    ${source}
    self.onmessage = async ({data}) => {
      const results = [];
      for (const entry of data.items) {
        try {
          const result = structuredClone(await grader.grade(entry.question, entry.solution, entry.answer, entry.item));
          results.push({questionId: entry.questionId, result});
        } catch (error) {
          results.push({questionId: entry.questionId, error: typeof error?.message === 'string' && error.message.trim() ? error.message : '该题评分失败。'});
        }
      }
      self.postMessage({job: data.job, results});
    };
    self.postMessage({ready:true});`;
  return workerSource;
}

export function gradingDocument(source: string, channel: string, nonceAttribute: string): string {
  const workerSource = workerDocument(source);
  return `<!doctype html><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonceAttribute}'; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">
    <script nonce="${nonceAttribute}">
      const channel = ${literal(channel)};
      const send = value => parent.postMessage({...value, channel}, '*');
      let worker;
      try {
        const url = URL.createObjectURL(new Blob([${literal(workerSource)}], {type:'text/javascript'}));
        worker = new Worker(url); URL.revokeObjectURL(url);
        worker.onmessage = ({data}) => send(data);
        worker.onerror = event => { event.preventDefault(); send({error:true}); };
        addEventListener('message', event => {
          if (event.source === parent && event.data?.channel === channel) worker.postMessage(event.data);
        });
      } catch { send({error:true}); }
    </script>`;
}
