function resourceMap(assets){
  const result=new Map();
  for(const asset of assets||[]){
    const data=asset?.data??asset?.base64;
    if(typeof asset?.path!=='string'||typeof data!=='string'||!/^(image\/(?:png|jpeg|gif|webp|svg\+xml|avif)|font\/(?:woff2?|ttf|otf))$/.test(asset.mime))throw new Error('开发预览资源无效');
    result.set(asset.path.replace(/^\.\//,''),`data:${asset.mime};base64,${data}`);
  }
  return result;
}
function localResource(value,resources,base=''){
  if(!value||/^(?:data:|blob:|#)/i.test(value))return value;
  try{
    const url=new URL(value,`https://preview.invalid/${base}`);
    if(url.origin!=='https://preview.invalid')return '';
    return resources.get(decodeURIComponent(url.pathname.slice(1)))||'';
  }catch{return '';}
}
function localStyle(value,resources,base){
  return String(value||'').replace(/@import\s+(?:url\([^)]*\)|['"][^'"]*['"])[^;]*;?/gi,'').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,(_all,_quote,path)=>`url("${localResource(path,resources,base).replace(/"/g,'%22')}")`);
}
const escapeAttribute=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const bodyTag=body=>`<body${[...body.attributes].filter(attr=>/^[A-Za-z_:][A-Za-z0-9_:.-]*$/.test(attr.name)).map(attr=>` ${attr.name}="${escapeAttribute(attr.value)}"`).join('')}>`;

// Static declared media work throughout the same page's development/runtime/
// published lifetime. Resource uploads and dynamic rich text still use QF.
export function inlinePageAssets(page,{document=globalThis.document}={}){
  const Parser=document.defaultView?.DOMParser||globalThis.DOMParser;
  const source=new Parser().parseFromString(page.html,'text/html'),resources=resourceMap(page.assets);
  for(const node of source.querySelectorAll('[src],[style]')){
    if(node.hasAttribute('src')&&node.tagName!=='SCRIPT'){
      const value=localResource(node.getAttribute('src'),resources,page.entryPath||'');
      if(value)node.setAttribute('src',value);else node.removeAttribute('src');
      node.removeAttribute('srcset');
    }
    if(node.hasAttribute('style'))node.setAttribute('style',localStyle(node.getAttribute('style'),resources,page.entryPath||''));
  }
  for(const node of source.querySelectorAll('style'))node.textContent=localStyle(node.textContent,resources,page.entryPath||'');
  const headStyles=[...source.head.querySelectorAll('style')].map(node=>node.textContent).join('\n');
  return {...page,html:source.body.innerHTML,bodyTag:bodyTag(source.body),style:headStyles+'\n'+localStyle(page.style,resources,page.stylePath||'')};
}


// Old development HTML fixtures join the ordinary extension mount. Only declared
// local media and classic inline scripts are adapted; no second message channel.
export function prepareLegacyPage(page,{document=globalThis.document}={}){
  const Parser=document.defaultView?.DOMParser||globalThis.DOMParser;
  const source=new Parser().parseFromString(page.html,'text/html'),scripts=[];
  for(const script of [...source.querySelectorAll('script')]){
    if(!script.hasAttribute('src')&&(!script.type||['text/javascript','application/javascript'].includes(script.type)))scripts.push(script.textContent);
    script.remove();
  }
  for(const node of [...source.querySelectorAll('base,link,meta[http-equiv],iframe,object,embed')])node.remove();
  for(const node of source.querySelectorAll('*')){
    for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['srcdoc','nonce'].includes(attr.name))node.removeAttribute(attr.name);
    if(node.tagName==='FORM'){node.removeAttribute('action');node.removeAttribute('target');}
    if(node.tagName==='A'&&!node.getAttribute('href')?.startsWith('#'))node.removeAttribute('href');
  }
  return inlinePageAssets({...page,html:source.documentElement.outerHTML,script:[...scripts,page.script||''].filter(Boolean).join('\n')},{document});
}
