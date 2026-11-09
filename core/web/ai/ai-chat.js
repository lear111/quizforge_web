// Compatibility boundary: the host owns the sidebar tabs; Vue owns chat content.
export function bindAiChat({ document, request }) {
  const get = id => document.getElementById(id), tabs = [get('outline-tab'), get('ai-chat-tab')];
  const mount = document.defaultView.QuizForgeUI?.mountAiChat;
  if (!mount) throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const chat = mount({ container: get('ai-chat-root'), request });
  const removers = [];
  function select(index) {
    tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    get('outline-panel').hidden = index !== 0; get('ai-chat-panel').hidden = index !== 1;
    document.querySelector('.app-shell').classList.toggle('ai-chat-open', index === 1);
  }
  tabs.forEach((tab, index) => {
    const click = () => select(index);
    const keydown = event => {
      let next;
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) next = 1 - index;
      else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = 1; else return;
      event.preventDefault(); select(next); tabs[next].focus();
    };
    tab.addEventListener('click', click); tab.addEventListener('keydown', keydown);
    removers.push(() => { tab.removeEventListener('click', click); tab.removeEventListener('keydown', keydown); });
  });
  return { cancel: chat.cancel, destroy() { removers.forEach(remove => remove()); chat.destroy(); } };
}
