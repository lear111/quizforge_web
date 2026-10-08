import {Editor,Node} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {cloneDocument,fromEditorDocument,IMAGE_TYPES} from './document.js';

let current=null;
function createEditor(container,{doc,onChange,resources,placeholder='在这里输入内容…'}={}){
  if(current)throw new Error('一个页面同时只能编辑一个富文本字段。');
  let disposed=false,editor,epoch=0;const uploads=new Set();let uploadFailure=null;
  const root=document.createElement('div');root.className='qfrt-editor';
  const toolbar=document.createElement('div');toolbar.className='qfrt-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','富文本工具');
  const body=document.createElement('div'),message=document.createElement('p');message.className='qfrt-message';message.hidden=true;
  root.append(toolbar,body,message);container.replaceChildren(root);
  const report=error=>{if(disposed)return;message.textContent=error?.message||String(error);message.hidden=false;};
  const Image=Node.create({name:'image',group:'block',atom:true,draggable:true,
    addAttributes(){return {assetId:{default:null},alt:{default:null},title:{default:null}};},
    parseHTML(){return [{tag:'img[data-asset-id]',getAttrs:element=>/^[a-f0-9]{64}$/.test(element.getAttribute('data-asset-id'))?{assetId:element.getAttribute('data-asset-id'),alt:element.getAttribute('alt'),title:element.getAttribute('title')}:false}];},
    renderHTML({node}){return ['img',{'data-asset-id':node.attrs.assetId,alt:node.attrs.alt||'',title:node.attrs.title||''}];},
    addNodeView(){return ({node})=>{const image=document.createElement('img');image.className='qfrt-image';image.alt=node.attrs.alt||'图片';let live=true,version=0;
      const load=value=>{const token=++version;image.dataset.assetId=value.attrs.assetId;image.alt=value.attrs.alt||'图片';Promise.resolve().then(()=>resources.get(value.attrs.assetId)).then(asset=>{if(live&&!disposed&&token===version)image.src=asset.url;}).catch(()=>{if(live&&!disposed&&token===version){image.removeAttribute('src');image.alt='图片无法加载';}});};load(node);
      return {dom:image,update(value){if(value.type.name!=='image')return false;load(value);return true;},destroy(){live=false;version++;image.removeAttribute('src');}};};}
  });
  function clean(){return fromEditorDocument(editor.getJSON());}
  function changed(){try{const document=clean();message.hidden=true;onChange?.(document);}catch(error){report(error);}}
  function action(label,text,run){const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.textContent=text;button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>{if(disposed)return;try{run();}catch(error){report(error);}});toolbar.append(button);return button;}
  const chain=()=>editor.chain().focus();
  action('粗体','B',()=>chain().toggleBold().run());action('斜体','I',()=>chain().toggleItalic().run());action('下划线','U',()=>chain().toggleUnderline().run());
  action('二级标题','H₂',()=>chain().toggleHeading({level:2}).run());action('无序列表','• ≡',()=>chain().toggleBulletList().run());action('有序列表','1 ≡',()=>chain().toggleOrderedList().run());action('引用','❞',()=>chain().toggleBlockquote().run());action('代码块','</>',()=>chain().toggleCodeBlock().run());
  action('撤销','↶',()=>chain().undo().run());action('重做','↷',()=>chain().redo().run());
  const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif';input.hidden=true;root.append(input);
  const imageButton=action('插入图片','▧',()=>input.click());
  function upload(file){
    if(!IMAGE_TYPES.has(file?.type)||file.size<=0||file.size>4*1024*1024){report(new Error('请选择不超过 4 MiB 的 PNG、JPEG、WebP 或 GIF 图片。'));return Promise.resolve();}
    if(!resources?.put){report(new Error('图片上传接口不可用。'));return Promise.resolve();}
    const token=epoch;imageButton.disabled=true;message.textContent='正在保存图片…';message.hidden=false;
    const pending=Promise.resolve().then(()=>resources.put(file)).then(asset=>{if(disposed||token!==epoch)return;if(!/^[a-f0-9]{64}$/.test(asset?.id))throw new Error('图片资源标识无效。');editor.chain().focus().insertContent({type:'image',attrs:{assetId:asset.id,alt:(file.name||'图片').slice(0,500)}}).run();uploadFailure=null;message.hidden=true;}).catch(error=>{if(disposed||token!==epoch)return;uploadFailure=error;report(error);}).finally(()=>{uploads.delete(pending);if(!disposed)imageButton.disabled=uploads.size>0;});uploads.add(pending);return pending;
  }
  input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)upload(file);});
  const capture=(event,files)=>{const file=[...files].find(value=>value.type.startsWith('image/'));if(!file)return false;event.preventDefault();upload(file);return true;};
  try{editor=new Editor({element:body,extensions:[StarterKit.configure({heading:{levels:[1,2,3]},link:{openOnClick:false,autolink:false,protocols:['http','https','mailto']},trailingNode:false}),Placeholder.configure({placeholder}),Image],content:cloneDocument(doc),onUpdate:changed,
    editorProps:{attributes:{class:'qfrt-document',role:'textbox','aria-multiline':'true','aria-label':placeholder},handlePaste(_view,event){return capture(event,event.clipboardData?.files||[]);},handleDrop(_view,event){return capture(event,event.dataTransfer?.files||[]);}}});}
  catch(error){root.remove();throw error;}
  const api={getDocument:clean,setDocument(value){epoch++;uploadFailure=null;editor.commands.setContent(cloneDocument(value),{emitUpdate:false,errorOnInvalidContent:true});},focus(){editor.commands.focus();},isUploading:()=>uploads.size>0,async flush(){await Promise.all([...uploads]);if(uploadFailure)throw uploadFailure;clean();},ready:Promise.resolve(),destroy(){if(disposed)return;disposed=true;epoch++;editor.destroy();root.remove();if(current===api)current=null;}};current=api;return api;
}
if(!globalThis.QFRichText)throw new Error('Load the QuizForge rich-text renderer before the editor.');
globalThis.QFRichText._createEditor=createEditor;
