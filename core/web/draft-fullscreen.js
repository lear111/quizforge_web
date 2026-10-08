// Keep fullscreen ownership separate from the browser's current fullscreen
// element, so changing draft mode never exits fullscreen opened elsewhere.
export function createDraftFullscreen(doc, {
  canEnter = () => false,
  onChange = () => {},
  onError = () => {},
} = {}) {
  const target = doc.documentElement;
  const supported = doc.fullscreenEnabled !== false
    && typeof target?.requestFullscreen === 'function'
    && typeof doc.exitFullscreen === 'function';
  let owned = false;
  let action = null;
  let operation = null;
  let destroyed = false;

  function getState() {
    return { supported, active: owned && doc.fullscreenElement === target, pending: action !== null };
  }

  function publish() {
    if (!destroyed) onChange(getState());
  }

  function fail(message, cause) {
    if (!destroyed) onError(new Error(message, { cause }));
  }

  function exit() {
    if (action || !owned || doc.fullscreenElement !== target) return operation ?? Promise.resolve(false);
    action = 'exit';
    let result;
    try {
      result = doc.exitFullscreen();
    } catch (error) {
      action = null;
      publish();
      fail('无法退出全屏，请使用浏览器返回键退出。', error);
      return Promise.resolve(false);
    }
    publish();
    operation = Promise.resolve(result).then(() => {
      action = null;
      if (doc.fullscreenElement !== target) owned = false;
      publish();
      return !getState().active;
    }, error => {
      action = null;
      if (doc.fullscreenElement !== target) owned = false;
      publish();
      fail('无法退出全屏，请使用浏览器返回键退出。', error);
      return false;
    });
    return operation;
  }

  function sync() {
    if (owned && doc.fullscreenElement !== target && action !== 'enter') owned = false;
    if (owned && doc.fullscreenElement === target && !action && (destroyed || !canEnter())) exit();
    publish();
    return getState();
  }

  function toggle() {
    if (destroyed) return Promise.resolve(false);
    if (action) return operation ?? Promise.resolve(false);
    if (getState().active) return exit();
    if (!canEnter()) return Promise.resolve(false);
    if (!supported) {
      fail('当前浏览器不支持全屏模式。');
      return Promise.resolve(false);
    }
    // Do not adopt fullscreen entered by another control or browser action.
    if (doc.fullscreenElement) return Promise.resolve(false);

    owned = true;
    action = 'enter';
    let result;
    try {
      // Call directly during the toolbar click; awaiting first loses the user
      // activation required by Android Chrome and other browsers.
      result = target.requestFullscreen({ navigationUI: 'hide' });
    } catch (error) {
      action = null;
      owned = false;
      publish();
      fail('无法进入全屏，请通过草稿工具栏重试。', error);
      return Promise.resolve(false);
    }
    publish();
    operation = Promise.resolve(result).then(() => {
      action = null;
      if (doc.fullscreenElement !== target) owned = false;
      // Mode can change before the fullscreen request finishes. Restore the
      // browser once entry completes, even if destroy already removed listeners.
      if (getState().active && (destroyed || !canEnter())) return exit().then(() => getState().active);
      publish();
      return getState().active;
    }, error => {
      action = null;
      if (doc.fullscreenElement !== target) owned = false;
      publish();
      fail('无法进入全屏，请通过草稿工具栏重试。', error);
      return false;
    });
    return operation;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    doc.removeEventListener('fullscreenchange', sync);
    if (!action) exit();
  }

  doc.addEventListener('fullscreenchange', sync);
  return { toggle, sync, getState, destroy };
}
