function missing(image) {
  image.removeAttribute('src');
  image.alt = `${image.alt || '题目图片'}（图片无法加载）`;
  image.classList.add('qfrt-image-missing');
}
function load(image, resources, lifecycle) {
  const reference = image.getAttribute('src');
  image.removeAttribute('src');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (failed = false) => {
      if (settled) {
        return;
      }
      settled = true;
      image.onload = image.onerror = null;
      lifecycle.pending.delete(cancel);
      if (failed && !lifecycle.disposed) {
        missing(image);
      }
      resolve();
    };
    const cancel = () => {
      image.removeAttribute('src');
      finish();
    };
    lifecycle.pending.add(cancel);
    if (!reference) {
      finish(true);
      return;
    }
    Promise.resolve()
      .then(() => (lifecycle.disposed ? null : resources?.get(reference)))
      .then((asset) => {
        if (lifecycle.disposed) {
          return;
        }
        if (!asset || typeof asset.url !== 'string') {
          throw new Error('图片资源不可用');
        }
        image.onload = () => finish();
        image.onerror = () => finish(true);
        image.src = asset.url;
        if (image.complete) {
          finish(!image.naturalWidth);
        }
      })
      .catch(() => finish(true));
  });
}
export function loadImages(root, resources) {
  const lifecycle = { disposed: false, pending: new Set() };
  const ready = Promise.all(
    [...root.querySelectorAll('img')].map((image) => load(image, resources, lifecycle)),
  ).then(() => undefined);
  return {
    ready,
    destroy() {
      lifecycle.disposed = true;
      for (const cancel of lifecycle.pending) {
        cancel();
      }
    },
  };
}
