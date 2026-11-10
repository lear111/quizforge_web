// The host keeps the container and command callbacks; Vue owns this card only.
const bindings=new WeakMap();
export function mountPracticeSummary(container,summary,options={}){
  bindings.get(container)?.destroy();
  const document=container.ownerDocument,factory=document.defaultView.QuizForgeUI?.mountPracticeSummary;
  if(!factory)throw Error('缺少界面构建文件，请运行 npm --prefix core run build:ui。');
  const card=document.createElement('section');card.className='practice-summary-card';container.append(card);
  let view,destroyed=false,widget;
  try{widget=factory({container:card,summary,...options,isCurrent:()=>!destroyed&&bindings.get(container)===view&&card.isConnected});}
  catch(error){card.remove();throw error;}
  view={update:widget.update,destroy(){if(destroyed)return;destroyed=true;widget.destroy();card.remove();if(bindings.get(container)===view)bindings.delete(container);}};
  bindings.set(container,view);return view;
}
