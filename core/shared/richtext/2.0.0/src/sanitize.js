import createDOMPurify from 'dompurify';

export const TAGS = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'hr',
  'pre',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'sub',
  'sup',
  'mark',
  'code',
  'span',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'a',
];
export const STYLES = [
  'color',
  'background-color',
  'font-size',
  'font-family',
  'text-align',
  'line-height',
  'text-indent',
  'margin-left',
  'vertical-align',
  'width',
];
const attributes = {
  img: ['src', 'alt', 'width'],
  a: ['href'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

function assetReference(value) {
  if (!value.startsWith('qf-asset:')) {
    return false;
  }
  const relative = value.slice(9);
  // Same relative-path vocabulary as the host; get() remains the authority.
  return (
    relative.length > 0 &&
    relative.length <= 1000 &&
    // eslint-disable-next-line no-control-regex -- Reject controls, as the host does.
    !/[\\:\x00-\x1f\x7f?#]/.test(relative) &&
    relative
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          part.toLowerCase() !== '.qf-v2' &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

function cleanStyle(document, source) {
  const parsed = document.createElement('span').style;
  const result = document.createElement('span').style;
  parsed.cssText = source;
  for (const name of STYLES) {
    result.setProperty(name, parsed.getPropertyValue(name));
  }
  return result.cssText;
}

export function sanitizer(window) {
  const purify = createDOMPurify(window);
  purify.addHook('uponSanitizeAttribute', (element, data) => {
    const tag = element.localName;
    data.keepAttr = data.attrName === 'style' || (attributes[tag] ?? []).includes(data.attrName);
    if (data.attrName === 'src') {
      data.keepAttr = tag === 'img' && assetReference(data.attrValue);
    } else if (data.attrName === 'href') {
      data.keepAttr = tag === 'a' && /^(https?:|mailto:)/i.test(data.attrValue);
    } else if (data.attrName === 'style') {
      data.attrValue = cleanStyle(window.document, data.attrValue);
      data.keepAttr = Boolean(data.attrValue);
    }
  });
  return (html) =>
    purify.sanitize(html, {
      ALLOWED_TAGS: TAGS,
      ALLOWED_ATTR: ['style', 'src', 'alt', 'width', 'href', 'colspan', 'rowspan'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:qf-asset:|https?:|mailto:)/i,
      ADD_URI_SAFE_ATTR: ['colspan', 'rowspan', 'width'],
      RETURN_DOM_FRAGMENT: true,
    });
}
