import {validateDocument} from '../../../core/shared/richtext/1.0.0/src/document.js';

/** Pure protocol conversion: formatting becomes readable text, images stay hash references. */
export function toAiBlocks(doc){
  if(!validateDocument(doc,{requireContent:true}))throw new Error('评分内容不是有效的富文本文档。');
  const blocks=[];
  const addText=text=>{if(!text.trim())return;const previous=blocks.at(-1);if(previous?.type==='text')previous.text+='\n\n'+text;else blocks.push({type:'text',text});};
  const inline=node=>{if(node.type==='hardBreak')return '\n';if(node.type!=='text')return (node.content||[]).map(inline).join('');const link=node.marks?.find(mark=>mark.type==='link');return link?`${node.text} (${link.attrs.href})`:node.text;};
  function walk(node,prefix='',depth=0){
    if(node.type==='image'){blocks.push({type:'image',assetId:node.attrs.assetId,alt:node.attrs.alt||node.attrs.title||''});return;}
    if(node.type==='paragraph'||node.type==='heading'){const text=(node.content||[]).map(inline).join('');addText(prefix+(node.type==='heading'?'#'.repeat(node.attrs.level)+' ':'')+text);return;}
    if(node.type==='codeBlock'){addText(`${prefix}\`\`\`${node.attrs?.language||''}\n${(node.content||[]).map(inline).join('')}\n\`\`\``);return;}
    if(node.type==='horizontalRule'){addText(prefix+'---');return;}
    if(node.type==='blockquote'){for(const child of node.content||[])walk(child,prefix+'> ',depth);return;}
    if(node.type==='bulletList'||node.type==='orderedList'){let index=node.attrs?.start||1;for(const item of node.content||[]){const marker=node.type==='orderedList'?`${index++}. `:'• ';for(let i=0;i<(item.content||[]).length;i++){const child=item.content[i];walk(child,prefix+'  '.repeat(depth)+(i===0?marker:'  '),depth+1);}}return;}
    for(const child of node.content||[])walk(child,prefix,depth);
  }
  walk(doc);if(!blocks.length)throw new Error('评分内容为空。');return blocks;
}

export function prepareAiGrading(data,answer){
  if(!data||data.formatVersion!==1||!answer||answer.formatVersion!==1||!Number.isFinite(data.maxScore)||data.maxScore<=0||data.maxScore>100000||!Number.isInteger(data.maxScore*2))throw new Error('简答题评分数据无效。');
  return {protocolVersion:1,question:toAiBlocks(data.stem),answer:toAiBlocks(answer.document),referenceAnswer:toAiBlocks(data.referenceAnswer),rubric:toAiBlocks(data.rubric),maxScore:data.maxScore,scoreStep:0.5};
}
