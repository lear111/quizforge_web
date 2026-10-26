import {extensionGroups} from './extension-groups.js';

const nameOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
const compareItems=(left,right)=>nameOrder.compare(left.title||left.name||'',right.title||right.name||'')
  ||nameOrder.compare(left.path||left.id||'',right.path||right.id||'');
// Discover groups once per page session; polling must preserve manual expansion.
const seenBankGroups=new WeakMap();

export function renderLibraryView({document,catalog,listMode,activeKey,collapsedGroups,onNotice,onOpen,onManage}){
  const $=selector=>document.querySelector(selector);
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
  $('.library-switch').hidden=!catalog.developmentEnabled;if(!catalog.developmentEnabled)listMode='bank';
  $('#welcome p').textContent=catalog.developmentEnabled?'选择左侧题库，或到拓展列表体验样例。':'选择左侧题库，开始练习。';
  $('#show-banks').setAttribute('aria-selected',String(listMode==='bank'));$('#show-extensions').setAttribute('aria-selected',String(listMode==='extension'));$('#library-label').textContent=listMode==='bank'?'我的题库':'题型拓展';
  const root=$('#library-list');root.replaceChildren();const rows=[...(listMode==='bank'?catalog.banks:catalog.extensions)].sort(compareItems);
  $('#library-new-group').hidden=!catalog.canManage||listMode!=='bank';
  $('#library-import').hidden=!catalog.canManage||listMode!=='bank';
  const actions=(target,row)=>{const tools=el('span','library-row-actions');if(!catalog.canManage)return tools;
    const entries=[['update','编辑','m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5']];
    for(const [action,label,path]of entries){
      const button=el('button',`library-manage-action${action==='delete'?' remove':''}`);button.type='button';button.title=button.ariaLabel=`${label}${target==='group'?'分组':''} ${row.title||row.name}`;button.dataset.libraryAction=action;
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');shape.setAttribute('d',path);svg.append(shape);button.append(svg);
      button.addEventListener('click',()=>onManage(target,row,action));tools.append(button);
    }return tools;
  };
  const appendItem=(container,row)=>{const kind=row.kind?.startsWith('development')?row.kind:listMode,key=`${kind}:${row.id}`,button=el('button',`library-item${key===activeKey?' active':''}`);button.dataset.itemId=row.id;
    const body=el('span','item-body'),title=el('span','item-title');button.title=row.title||row.name;title.append(el('span','item-name',row.title||row.name));if(row.development)title.append(el('span','development-badge','开发版'));body.append(title);body.append(el('span',`item-meta${row.error?' item-error':''}`,row.error?(typeof row.error==='string'?row.error:row.error.message):`${row.questionCount??0} ${listMode==='bank'?'道题目':'道样例'}${row.version&&!row.development?' · v'+row.version:''}`));
    button.append(el('span','item-icon',listMode==='bank'?'▤':row.development?'⌘':'◇'),body);button.addEventListener('click',()=>{if(row.error){onNotice(typeof row.error==='string'?row.error:row.error.message);return;}onOpen(kind,row.id);});const item=el('div','library-row');item.append(button,actions('item',row));container.append(item);
  };
  const appendGroups=(container,nodes)=>{for(const group of nodes){
    if(group.kind!=='group'){appendItem(container,group.row);continue;}
    const section=el('section','extension-group'),toggle=el('button','extension-group-toggle'),arrow=el('span','extension-group-arrow'),body=el('div','extension-group-body');
    toggle.type='button';toggle.dataset.extensionGroup=group.path;body.id=`extension-group-${encodeURIComponent(group.path)}`;toggle.setAttribute('aria-controls',body.id);arrow.setAttribute('aria-hidden','true');toggle.append(arrow,el('span','extension-group-label',group.name));
    const collapseKey=`${listMode}:${group.path}`;
    if(listMode==='bank'){
      let seen=seenBankGroups.get(collapsedGroups);
      if(!seen){seen=new Set();seenBankGroups.set(collapsedGroups,seen);}
      if(!seen.has(collapseKey)){seen.add(collapseKey);collapsedGroups.add(collapseKey);}
    }
    const sync=()=>{const expanded=!collapsedGroups.has(collapseKey);body.hidden=!expanded;arrow.textContent=expanded?'▾':'▸';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',`${expanded?'折叠':'展开'} ${group.path}`);};
    toggle.addEventListener('click',()=>{if(collapsedGroups.has(collapseKey))collapsedGroups.delete(collapseKey);else collapsedGroups.add(collapseKey);sync();});sync();appendGroups(body,group.children);const header=el('div','library-group-header');header.append(toggle,actions('group',{name:group.name,path:group.path,group:group.path.includes('/')?group.path.slice(0,group.path.lastIndexOf('/')):''}));section.append(header,body);container.append(section);
  }};
  const groups=extensionGroups(rows,catalog.groups?.[listMode==='bank'?'banks':'extensions']||[]);
  groups.sort((left,right)=>left.kind===right.kind?left.kind==='group'?nameOrder.compare(left.name,right.name):compareItems(left.row,right.row):left.kind==='group'?1:-1);
  appendGroups(root,groups);
  if(!groups.length){
    const message=listMode!=='bank'?'目录中还没有拓展。添加文件后刷新列表。':catalog.canManage?'还没有题库。点击“获取题库”下载题库包，再通过上方导入按钮添加。':'还没有题库。请在运行应用的主机上导入题库包。';
    root.append(el('p','list-empty',message));
  }
  return listMode;
}
