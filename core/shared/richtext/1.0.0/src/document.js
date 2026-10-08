export const EMPTY_DOCUMENT={type:'doc',content:[{type:'paragraph'}]};
export const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const hash=/^[a-f0-9]{64}$/;
const blocks=new Set(['paragraph','heading','blockquote','bulletList','orderedList','codeBlock','horizontalRule','image']);
const inlines=new Set(['text','hardBreak']);
const marks=new Set(['bold','italic','strike','underline','code','link']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
export function safeLink(value){return typeof value==='string'&&value.length<=2048&&/^(https?:\/\/|mailto:)/i.test(value)&&!/[\u0000-\u0020]/.test(value);}
export function validateDocument(doc,{requireContent=false}={}){
  let count=0,textSize=0,images=0,meaningful=false;
  function visit(node,depth,parent){
    if(!object(node)||depth>32||++count>5000||!keys(node,['type','attrs','content','text','marks']))return false;
    const type=node.type,attrs=node.attrs||{};
    if(typeof type!=='string'||!object(attrs))return false;
    if(parent==='doc'&&!blocks.has(type)||parent==='list'&&type!=='listItem'||parent==='inline'&&!inlines.has(type)||parent==='code'&&type!=='text'||parent==='block'&&!blocks.has(type))return false;
    if(type==='text'){
      if(typeof node.text!=='string'||!node.text.length||node.content||Object.keys(attrs).length||(textSize+=node.text.length)>100000)return false;
      if(node.text.trim())meaningful=true;
      if(node.marks!==undefined){if(!Array.isArray(node.marks)||node.marks.length>6)return false;const used=new Set();for(const mark of node.marks){if(!object(mark)||!keys(mark,['type','attrs'])||!marks.has(mark.type)||used.has(mark.type))return false;used.add(mark.type);const ma=mark.attrs||{};if(!object(ma))return false;if(mark.type==='link'){if(!keys(ma,['href','title'])||!safeLink(ma.href)||ma.title!==undefined&&(typeof ma.title!=='string'||ma.title.length>500))return false;}else if(Object.keys(ma).length)return false;}if(parent==='code'&&node.marks.length)return false;}
      return true;
    }
    if(node.text!==undefined||node.marks!==undefined)return false;
    if(type==='image'){
      if(!keys(attrs,['assetId','alt','title'])||!hash.test(attrs.assetId)||++images>40||node.content!==undefined)return false;
      if(['alt','title'].some(key=>attrs[key]!==undefined&&(typeof attrs[key]!=='string'||attrs[key].length>500)))return false;
      meaningful=true;return true;
    }
    if(type==='heading'){if(!keys(attrs,['level'])||![1,2,3].includes(attrs.level))return false;}
    else if(type==='orderedList'){if(!keys(attrs,['start'])||attrs.start!==undefined&&(!Number.isInteger(attrs.start)||attrs.start<1||attrs.start>9999))return false;}
    else if(type==='codeBlock'){if(!keys(attrs,['language'])||attrs.language!==undefined&&attrs.language!==null&&(typeof attrs.language!=='string'||attrs.language.length>40))return false;}
    else if(Object.keys(attrs).length)return false;
    if(type==='hardBreak'||type==='horizontalRule')return node.content===undefined;
    const content=node.content||[];if(!Array.isArray(content))return false;
    if(type==='doc'){if(depth!==0||!content.length)return false;return content.every(child=>visit(child,depth+1,'doc'));}
    if(type==='paragraph'||type==='heading')return content.every(child=>visit(child,depth+1,'inline'));
    if(type==='codeBlock')return content.every(child=>visit(child,depth+1,'code'));
    if(type==='bulletList'||type==='orderedList')return !!content.length&&content.every(child=>visit(child,depth+1,'list'));
    if(type==='blockquote')return !!content.length&&content.every(child=>visit(child,depth+1,'block'));
    if(type==='listItem')return !!content.length&&content[0].type==='paragraph'&&content.every(child=>visit(child,depth+1,'block'));
    return false;
  }
  try{return object(doc)&&doc.type==='doc'&&visit(doc,0,null)&&(!requireContent||meaningful);}catch{return false;}
}
export function cloneDocument(doc){if(!validateDocument(doc))throw new Error('富文本内容格式无效。');return JSON.parse(JSON.stringify(doc));}
export const isEmpty=doc=>!validateDocument(doc,{requireContent:true});
// Editor schemas add default HTML-only attributes. Never persist them or blob URLs.
export function fromEditorDocument(doc){
  function copy(node){const value={type:node.type};if(node.text!==undefined)value.text=node.text;
    if(node.content?.length)value.content=node.content.map(copy);
    if(node.type==='image'){value.attrs={assetId:node.attrs?.assetId};for(const key of ['alt','title'])if(typeof node.attrs?.[key]==='string'&&node.attrs[key])value.attrs[key]=node.attrs[key];}
    if(node.type==='heading')value.attrs={level:node.attrs.level};
    if(node.type==='orderedList'&&node.attrs?.start!==1)value.attrs={start:node.attrs.start};
    if(node.type==='codeBlock'&&node.attrs?.language)value.attrs={language:node.attrs.language};
    if(node.marks?.length)value.marks=node.marks.map(mark=>mark.type==='link'?{type:'link',attrs:{href:mark.attrs.href}}:{type:mark.type});
    return value;}
  return cloneDocument(copy(doc));
}
