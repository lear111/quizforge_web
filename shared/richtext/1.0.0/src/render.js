import {cloneDocument,safeLink} from './document.js';
const tags={paragraph:'p',blockquote:'blockquote',bulletList:'ul',orderedList:'ol',listItem:'li',hardBreak:'br',horizontalRule:'hr'};
const markTags={bold:'strong',italic:'em',strike:'s',underline:'u',code:'code',link:'a'};
export function render(container,doc,{resources}={}){
  const value=cloneDocument(doc),root=document.createElement('div');root.className='qfrt-document';let disposed=false;const pending=[];
  function node(source){
    if(source.type==='text'){let current=document.createTextNode(source.text);for(const mark of source.marks||[]){const wrapper=document.createElement(markTags[mark.type]);if(mark.type==='link'&&safeLink(mark.attrs.href)){wrapper.href=mark.attrs.href;wrapper.target='_blank';wrapper.rel='noopener noreferrer';if(mark.attrs.title)wrapper.title=mark.attrs.title;}wrapper.append(current);current=wrapper;}return current;}
    if(source.type==='image'){const image=document.createElement('img');image.alt=source.attrs.alt||'题目图片';if(source.attrs.title)image.title=source.attrs.title;image.dataset.assetId=source.attrs.assetId;image.className='qfrt-image';image.loading='lazy';
      const loading=Promise.resolve().then(()=>{if(!resources?.get)throw new Error('图片资源接口不可用');return resources.get(source.attrs.assetId);}).then(asset=>{if(disposed)return;if(!asset||typeof asset.url!=='string')throw new Error('图片资源无效');image.src=asset.url;}).catch(()=>{if(!disposed){image.alt=`${image.alt}（图片无法加载）`;image.classList.add('qfrt-image-missing');}});pending.push(loading);return image;}
    const tag=source.type==='heading'?`h${source.attrs.level}`:source.type==='codeBlock'?'pre':tags[source.type],element=document.createElement(tag);let childHost=element;
    if(source.type==='codeBlock'){childHost=document.createElement('code');element.append(childHost);}
    if(source.type==='orderedList'&&source.attrs?.start)element.start=source.attrs.start;
    for(const child of source.content||[])childHost.append(node(child));return element;
  }
  for(const child of value.content)root.append(node(child));container.replaceChildren(root);
  return {ready:Promise.all(pending).then(()=>undefined),destroy(){disposed=true;root.remove();}};
}
