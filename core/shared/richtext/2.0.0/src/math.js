import katex from 'katex';

function formula(document, latex, displayMode) {
  const node = document.createElement('span');
  node.className = displayMode ? 'qfrt-math qfrt-math-block' : 'qfrt-math';
  try {
    katex.render(latex, node, {
      displayMode,
      output: 'mathml',
      trust: false,
      throwOnError: false,
      strict: 'ignore',
      maxExpand: 1000,
    });
  } catch {
    node.textContent = latex;
  }
  return node;
}

function endOfMath(text, from, delimiter) {
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
    } else if (text.startsWith(delimiter, index)) {
      return index;
    }
  }
  return -1;
}

function textMath(node) {
  const document = node.ownerDocument,
    text = node.data;
  const output = document.createDocumentFragment();
  let plain = '';
  for (let index = 0; index < text.length;) {
    if (text[index] === '\\' && text[index + 1] === '$') {
      plain += '$';
      index += 2;
      continue;
    }
    const delimiter = text.startsWith('$$', index) ? '$$' : '$';
    const end = text[index] === '$' ? endOfMath(text, index + delimiter.length, delimiter) : -1;
    if (end < 0) {
      plain += text[index++];
      continue;
    }
    output.append(document.createTextNode(plain));
    plain = '';
    output.append(formula(document, text.slice(index + delimiter.length, end), delimiter === '$$'));
    index = end + delimiter.length;
  }
  output.append(document.createTextNode(plain));
  node.replaceWith(output);
}

export function renderMath(root) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest('code,pre')) {
      nodes.push(walker.currentNode);
    }
  }
  for (const node of nodes) {
    textMath(node);
  }
}
