import {historyProgress} from './history-view.js';

const mounted=new WeakMap();
export function bindHistoryList({document=globalThis.document,onOpen,onDelete}){
  const dialog=document.querySelector('#history-dialog'),confirmation=document.querySelector('#history-delete-dialog');
  const factory=document.defaultView.QuizForgeUI?.mountHistoryList;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  mounted.get(dialog)?.destroy();
  let pane=null,disposed=false,binding;
  const widget=factory({dialog,confirmation,container:document.querySelector('#history-root'),confirmationContainer:document.querySelector('#history-confirm-root'),isCurrent:()=>!disposed&&mounted.get(dialog)===binding&&dialog.isConnected});
  const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
  function update(owner,clearError=false){
    if(disposed||pane&&pane!==owner)return;
    const rows=owner.historyRecords.map(row=>({id:row.id,title:String(row.collectionTitle),exam:row.mode==='exam',
      progress:`${time(row.updatedAt||row.createdAt)} · ${historyProgress(row)}`,score:`${row.summary?.score??row.score} / ${row.summary?.maxScore??row.maxScore}`,
      deleteLabel:`删除 ${time(row.createdAt)} 的${row.mode==='exam'?'考试':''}历史记录`,detail:`${row.mode==='exam'?'考试 · ':''}${row.collectionTitle} · ${time(row.createdAt)}`}));
    widget.update({owner,title:`${owner.collection.title} · 历史记录`,rows,open:id=>onOpen(owner,id),remove:id=>onDelete(owner,id)},clearError);
  }
  binding={prepare(owner){if(disposed||widget.busy)return false;pane=owner;update(owner,true);return true;},update,error(message='',owner=pane){if(!disposed&&pane===owner)widget.error(message);},show:widget.show,
    get busy(){return widget.busy;},destroy(){if(disposed)return;disposed=true;widget.destroy();pane=null;if(mounted.get(dialog)===binding)mounted.delete(dialog);}};
  mounted.set(dialog,binding);return binding;
}
