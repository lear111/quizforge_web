const mounted=new WeakMap();

// Host callbacks own save preparation, HTTP, catalog updates and downloads.
// Vue exclusively owns the management form; no DOM edits here.
export function bindLibraryManagement(options){
  const document=options.document||globalThis.document;
  const dialog=document.querySelector('#library-manage-dialog');
  const container=document.querySelector('#library-manage-root');
  const ui=document.defaultView.QuizForgeUI;
  if(!ui?.mountLibraryManagement)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  mounted.get(dialog)?.destroy();
  const manager=ui.mountLibraryManagement({...options,container,dialog});
  mounted.set(dialog,manager);
  return {open:manager.open,destroy(){if(mounted.get(dialog)===manager){mounted.delete(dialog);manager.destroy();}}};
}
