/** Keep the status visible until the first extension frame is ready. */
export function createCollectionLoading(document) {
  const factory=document.defaultView.QuizForgeUI?.mountCollectionLoading;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const widget=factory(document.querySelector('#collection-loading'));
  let generation=0,disposed=false,model={title:'',detail:'',hidden:true};
  const publish=()=>{if(!disposed)widget.update(model);};publish();
  return {
    begin(name) {
      if(disposed)return {setDetail(){},finish(){}};
      const current=++generation;model={title:name||'',detail:'正在校验并加载题库…',hidden:false};publish();
      return {
        setDetail(text){if(!disposed&&current===generation){model={...model,detail:text};publish();}},
        finish(){if(!disposed&&current===generation){++generation;model={...model,hidden:true};publish();}},
      };
    },
    destroy(){if(disposed)return;disposed=true;++generation;widget.destroy();},
  };
}
