import assert from 'node:assert/strict';
import path from 'node:path';

function acceptanceHtml(reference) {
  return `<h1>HTML 富文本</h1><h2>标题与段落</h2><h3>小标题</h3><h4>四级标题</h4>
    <p style="color:#30313e;font-size:16px;text-align:left">粗体 <strong>重点</strong>，
      斜体 <em>提示</em> 与行内公式 $x^2+y^2=1$；价格 \\$5.00。</p>
    <blockquote>窄屏中的引用，长内容自动换行。</blockquote>
    <ul><li>图片由宿主资源通道提供</li><li>禁止远程图片</li></ul>
    <ol><li>先读题</li><li>再作答</li></ol>
    <table><thead><tr><th colspan="2">表格</th></tr></thead>
      <tbody><tr><td>数学</td><td>$$\\frac{1}{2}+\\frac{1}{2}=1$$</td></tr></tbody></table>
    <p><img src="${reference}" alt="HTML 资源图片" width="320"></p>
    <pre>$code$ 不解析公式</pre><p>非法公式：$\\invalid{$</p>
    <p onclick="window.__richtextAttack=true" style="background-image:url(https://richtext.invalid.test/css)">安全清洗</p>
    <img src="https://richtext.invalid.test/image"><script>window.__richtextAttack=true</script>
    <svg onload="window.__richtextAttack=true"></svg>`;
}

export async function checkHtmlRichtext(page, frame, reference, output, name) {
  const requests = [];
  const observe = (request) => {
    if (request.url().includes('richtext.invalid.test')) {
      requests.push(request.url());
    }
  };
  page.on('request', observe);
  try {
    const result = await frame.locator('#stem').evaluate(async (stem, html) => {
      const container = document.createElement('section');
      container.id = 'richtext-acceptance';
      stem.append(container);
      const view = QFRichText.render(container, html);
      await view.ready;
      const image = container.querySelector('img');
      return {
        markup: container.innerHTML,
        version: QFRichText.version,
        image: Boolean(image?.complete && image.naturalWidth > 0),
        math: container.querySelectorAll('math').length,
        colspan: container.querySelector('th').colSpan,
        headings: container.querySelectorAll('h1,h2,h3,h4').length,
        lists: container.querySelectorAll('ul,ol').length,
        code: container.querySelector('pre').textContent,
        forbidden: container.querySelectorAll('script,svg,[onclick],img[src^="https:"]').length,
        attacked: Boolean(window.__richtextAttack),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    }, acceptanceHtml(reference));
    assertRendering(result);
    assert.deepEqual(requests, []);
    await page.screenshot({ path: path.join(output, name + '-html-richtext.png'), fullPage: true });
    await frame.locator('#richtext-acceptance table').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, name + '-html-table.png'), fullPage: true });
  } finally {
    page.off('request', observe);
    await frame.locator('#richtext-acceptance').evaluate((node) => node.remove());
  }
}

function assertRendering(result) {
  assert.ok(result.image, result.markup);
  delete result.markup;
  assert.deepEqual(result, {
    version: '2.0.0',
    image: true,
    math: 2,
    colspan: 2,
    headings: 4,
    lists: 2,
    code: '$code$ 不解析公式',
    forbidden: 0,
    attacked: false,
    overflow: 0,
  });
}
