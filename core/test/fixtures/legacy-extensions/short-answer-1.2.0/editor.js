(function(){'use strict';
  const $=id=>document.getElementById(id),content=QF.content,fields=['stem','referenceAnswer','rubric'],empty={type:'doc',content:[{type:'paragraph'}]};
  let docs={},views=new Map(),editor=null,activeField=null,loaded=false,canEdit=false,original='',switching=Promise.resolve(),disposed=false;
  const copy=value=>JSON.parse(JSON.stringify(value)),resize=()=>{if(!disposed)QF.ui?.resize();};
  function error(message){if(disposed)return;$('editor-error').textContent=message;$('editor-error').hidden=false;resize();}
  function changed(){if(disposed)return;$('editor-error').hidden=true;$('editor-notice').textContent='点击页面上的保存按钮后，修改才会写入题库。';resize();}
  function titleFromStem(doc){
    function text(node){if(node.type==='text')return node.text;if(node.type==='inlineMath'||node.type==='blockMath')return node.attrs.latex;if(node.type==='hardBreak')return ' ';return (node.content||[]).map(text).join(node.type==='doc'?' ':'');}
    const value=text(doc).replace(/\s+/g,' ').trim();return value.slice(0,300)||'简答题';
  }
  function snapshot(){if(editor&&activeField)docs[activeField]=editor.getDocument();return {scoreText:$('edit-score').value,documents:copy(docs),formatVersion:1};}
  function read(){const draft=snapshot();return {title:titleFromStem(draft.documents.stem),data:{formatVersion:1,...draft.documents,maxScore:draft.scoreText.trim()===''?null:Number(draft.scoreText)}};}
  function preview(field){views.get(field)?.destroy();const host=$(`edit-${field}`);host.classList.remove('is-active');const view=content.render(host,docs[field]);views.set(field,view);view.ready?.then(resize);}
  async function flush(){await switching;await editor?.flush();if(editor&&activeField)docs[activeField]=editor.getDocument();}
  async function activate(field){if(!canEdit||disposed||activeField===field)return;
    await editor?.flush();if(disposed)return;
    if(editor&&activeField){docs[activeField]=editor.getDocument();editor.destroy();editor=null;preview(activeField);}
    views.get(field)?.destroy();views.delete(field);activeField=field;const host=$(`edit-${field}`);host.classList.add('is-active');
    const candidate=content.createEditor(host,{doc:docs[field],placeholder:`输入${{stem:'题干',referenceAnswer:'参考答案',rubric:'评分说明'}[field]}，可插入图片、表格或公式…`,onChange:doc=>{if(disposed)return;docs[field]=copy(doc);changed();}});
    editor=candidate;await candidate.ready;if(disposed||editor!==candidate){candidate.destroy();return;}candidate.focus();resize();
  }
  function schedule(field){switching=switching.catch(()=>{}).then(()=>activate(field));switching.catch(value=>error(value.message));}
  function destroy(){editor?.destroy();editor=null;activeField=null;for(const view of views.values())view.destroy();views.clear();}
  async function load(context){
    destroy();const question=context?.question;if(!question?.data)throw new Error('题目内容尚未就绪。');
    canEdit=context.mode==='edit'&&!!context.capabilities?.canEdit;$('editor-fields').disabled=!canEdit;$('edit-score').value=String(question.data.maxScore??'');
    docs=Object.fromEntries(fields.map(field=>[field,copy(question.data[field]||empty)]));for(const field of fields)preview(field);loaded=true;original=JSON.stringify(snapshot());changed();
  }
  async function getDocument(){
    await flush();if(!loaded||!canEdit)throw new Error('当前题目不能编辑。');const value=read();
    for(const field of fields)if(!content.validateDocument(value.data[field],{requireContent:true}))throw new Error(`请填写${{stem:'题干',referenceAnswer:'参考答案',rubric:'评分说明'}[field]}。`);
    if(!Number.isFinite(value.data.maxScore)||value.data.maxScore<=0||value.data.maxScore>100000||!Number.isInteger(value.data.maxScore*2))throw new Error('满分应大于 0，以 0.5 分为单位，且不超过 100000。');return value;
  }
  async function importDraft(draft){
    if(!draft||draft.formatVersion!==1||typeof draft.scoreText!=='string'||!draft.documents||fields.some(field=>!content.validateDocument(draft.documents[field])))throw new Error('编辑草稿格式无效。');
    await flush();destroy();$('edit-score').value=draft.scoreText;docs=copy(draft.documents);for(const field of fields)preview(field);changed();
  }
  $('question-editor').addEventListener('submit',event=>event.preventDefault());$('edit-score').addEventListener('input',changed);
  for(const field of fields){
    $(`activate-${field}`).addEventListener('click',()=>schedule(field));
    $(`edit-${field}`).addEventListener('click',()=>{if(activeField!==field)schedule(field);});
    $(`edit-${field}`).addEventListener('keydown',event=>{if(activeField!==field&&['Enter',' '].includes(event.key)){event.preventDefault();schedule(field);}});
  }
  QF.editor.register({onLoad:load,getDocument,hasChanges:()=>loaded&&JSON.stringify(snapshot())!==original,async exportDraft(){await flush();return snapshot();},importDraft,onFlush:flush,onDispose(){disposed=true;destroy();}});
})();
