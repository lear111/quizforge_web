// Test-only serialization and a deliberately narrow showcase allowlist.
// This is not the sanitizer or persistence format for third-party archives.
export function capturePage(root, resources) {
  const clone = root.cloneNode(true);
  const originals = [root, ...root.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const references = new Map([...resources].filter(([key]) => key.startsWith('qf-asset:')).map(([key, value]) => [value.url, key]));
  originals.forEach((node, index) => {
    const copy = copies[index], tag = node.localName;
    for (const { name } of [...copy.attributes]) if (name.startsWith('on')) copy.removeAttribute(name);
    if (tag === 'input') { copy.setAttribute('value', node.value); copy.toggleAttribute('checked', node.checked); }
    if (tag === 'textarea') copy.textContent = node.value;
    if (tag === 'option') copy.toggleAttribute('selected', node.selected);
    if (['input','select','textarea','button'].includes(tag)) { copy.setAttribute('disabled', ''); copy.setAttribute('readonly', ''); }
    if (tag === 'img') {
      const reference = references.get(node.getAttribute('src'));
      if (reference) copy.setAttribute('src', reference); else copy.removeAttribute('src');
    }
    if (tag === 'canvas') {
      const image = root.ownerDocument.createElement('img');
      image.setAttribute('src', node.toDataURL('image/png'));
      image.setAttribute('width', String(node.width)); image.setAttribute('height', String(node.height));
      copy.replaceWith(image);
    }
    if (tag === 'script') copy.remove();
  });
  return clone.innerHTML;
}

export function cleanSnapshot(html, images = null, document = globalThis.document) {
  const source = document.createElement('template'); source.innerHTML = html;
  const output = document.createElement('template');
  const htmlNS = 'http://www.w3.org/1999/xhtml', mathNS = 'http://www.w3.org/1998/Math/MathML';
  const htmlTags = new Set('a article aside b blockquote br button caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input label li mark ol option p pre s section select small span strong sub summary sup table tbody td textarea tfoot th thead tr u ul'.split(' '));
  const mathTags = new Set('annotation math menclose mfrac mi mn mo mover mpadded mphantom mroot mrow ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover semantics'.split(' '));
  const attrs = new Set('alt aria-hidden aria-label class colspan disabled height hidden id lang name open readonly role rowspan selected title value checked width'.split(' '));
  const mathAttrs = new Set('accent accentunder columnalign columnlines columnspacing depth display encoding fence form linethickness lspace mathcolor mathsize mathvariant maxsize minsize movablelimits notation rowalign rowlines rowspacing rspace scriptlevel separator stretchy symmetric voffset'.split(' '));
  const styles = new Set('background-color border-collapse color font-family font-size font-style font-weight height margin-left margin-right max-width min-width text-align text-decoration vertical-align white-space width'.split(' '));
  const canvasPng = /^data:image\/png;base64,[a-z0-9+/=]+$/i;
  function copyChildren(from, to) {
    for (const node of from.childNodes) {
      if (node.nodeType === 3) { to.append(output.ownerDocument.createTextNode(node.data)); continue; }
      if (node.nodeType !== 1) continue;
      const tag = node.localName, math = node.namespaceURI === mathNS;
      if (!(math ? mathTags.has(tag) : node.namespaceURI === htmlNS && htmlTags.has(tag))) continue;
      const next = output.ownerDocument.createElementNS(node.namespaceURI, tag);
      for (const { name, value } of node.attributes) {
        if (attrs.has(name) || math && mathAttrs.has(name)) next.setAttribute(name, value);
        if (tag === 'input' && name === 'type' && ['radio','checkbox','text','number'].includes(value)) next.setAttribute(name, value);
        if (tag === 'img' && name === 'src') {
          if (canvasPng.test(value)) next.setAttribute(name, value);
          else if (value.startsWith('qf-asset:') && images === null) next.setAttribute(name, value);
          else if (images && Object.hasOwn(images, value)) next.setAttribute(name, images[value]);
        }
        if (name === 'style' && node.style && next.style) for (const key of [...node.style]) {
          const text = node.style.getPropertyValue(key);
          if (styles.has(key) && /^[a-z0-9 \t.,%#'"+-]+$/i.test(text)) next.style.setProperty(key, text);
        }
      }
      if (['input','select','textarea','button'].includes(tag)) { next.setAttribute('disabled', ''); next.setAttribute('readonly', ''); }
      copyChildren(node, next); to.append(next);
    }
  }
  copyChildren(source.content, output.content);
  return output.innerHTML;
}
