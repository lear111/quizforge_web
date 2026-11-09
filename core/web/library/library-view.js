import {extensionGroups} from './extension-groups.js';

const nameOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
const compareItems=(left,right)=>nameOrder.compare(left.title||left.name||'',right.title||right.name||'')
  ||nameOrder.compare(left.path||left.id||'',right.path||right.id||'');

// The host owns catalog selection and toolbar controls. Vue exclusively owns
// #library-list. Rows remain plain objects: no reactive copy of the whole bank.
export function renderLibraryView(options){
  let {document,catalog,listMode,activeKey,collapsedGroups,onNotice,onOpen,onManage}=options;
  const $=selector=>document.querySelector(selector);
  $('.library-switch').hidden=!catalog.developmentEnabled;if(!catalog.developmentEnabled)listMode='bank';
  $('#welcome p').textContent=catalog.developmentEnabled?'选择左侧题库，或到拓展列表体验样例。':'选择左侧题库，开始练习。';
  $('#show-banks').setAttribute('aria-selected',String(listMode==='bank'));$('#show-extensions').setAttribute('aria-selected',String(listMode==='extension'));
  $('#library-label').textContent=listMode==='bank'?(catalog.documents?'我的文件':'我的题库'):'题型拓展';
  $('#library-new-group').hidden=!catalog.canManage||listMode!=='bank';
  $('#library-import').hidden=!catalog.canManage||listMode!=='bank';
  const rows=[...(listMode==='bank'?[...catalog.banks,...(catalog.documents||[])]:catalog.extensions)].sort(compareItems);
  const groups=extensionGroups(rows,catalog.groups?.[listMode==='bank'?'banks':'extensions']||[]);
  groups.sort((left,right)=>left.kind===right.kind?left.kind==='group'?nameOrder.compare(left.name,right.name):compareItems(left.row,right.row):left.kind==='group'?1:-1);
  const snapshot=nodes=>nodes.map(node=>node.kind==='group'?{...node,expanded:!collapsedGroups.has(`${listMode}:${node.path}`),children:snapshot(node.children)}:node);
  const ui=document.defaultView.QuizForgeUI;
  if(!ui?.renderLibrary)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const noun=catalog.documents?'文件':'题库';
  ui.renderLibrary({container:$('#library-list'),groups:snapshot(groups),mode:listMode,activeKey,canManage:Boolean(catalog.canManage),onNotice,onOpen,onManage,
    onToggleGroup:path=>{const key=`${listMode}:${path}`;if(collapsedGroups.has(key))collapsedGroups.delete(key);else collapsedGroups.add(key);renderLibraryView({...options,listMode});},
    emptyMessage:listMode!=='bank'?'目录中还没有拓展。添加文件后刷新列表。':catalog.canManage?`还没有${noun}。点击“获取题库”下载题库包，再通过上方导入按钮添加。`:`还没有${noun}。请在运行应用的主机上导入题库包。`});
  return listMode;
}
export function destroyLibraryView(document){
  const root=document.querySelector('#library-list');if(root)document.defaultView.QuizForgeUI?.unmountLibrary(root);
}
