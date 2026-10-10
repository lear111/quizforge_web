import {validateDocument} from '../../../core/shared/richtext/1.1.1/src/document.js';

/** Pure protocol conversion: formatting becomes readable text, images stay hash references. */
export function toAiBlocks(doc){
  if(!validateDocument(doc,{requireContent:true}))throw new Error('评分内容不是有效的富文本文档。');
  const blocks=[];
  const addText=text=>{if(!text.trim())return;const previous=blocks.at(-1);if(previous?.type==='text')previous.text+='\n\n'+text;else blocks.push({type:'text',text});};
  const inline=node=>{if(node.type==='hardBreak')return '\n';if(node.type==='inlineMath')return `$${node.attrs.latex}$`;if(node.type!=='text')return (node.content||[]).map(inline).join('');const link=node.marks?.find(mark=>mark.type==='link');return link?`${node.text} (${link.attrs.href})`:node.text;};
  function walk(node,prefix='',depth=0){
    if(node.type==='image'){blocks.push({type:'image',assetId:node.attrs.assetId,alt:node.attrs.alt||node.attrs.title||''});return;}
    if(node.type==='blockMath'){addText(`${prefix}$$\n${node.attrs.latex}\n$$`);return;}
    if(node.type==='paragraph'||node.type==='heading'){const text=(node.content||[]).map(inline).join('');addText(prefix+(node.type==='heading'?'#'.repeat(node.attrs.level)+' ':'')+text);return;}
    if(node.type==='codeBlock'){addText(`${prefix}\`\`\`${node.attrs?.language||''}\n${(node.content||[]).map(inline).join('')}\n\`\`\``);return;}
    if(node.type==='horizontalRule'){addText(prefix+'---');return;}
    if(node.type==='blockquote'){for(const child of node.content||[])walk(child,prefix+'> ',depth);return;}
    if(node.type==='table'){
      // Cell blocks keep normal text/image ordering. Coordinates and spans retain
      // table meaning even when a cell contains a diagram or nested paragraphs.
      addText(prefix+'表格开始');
      const occupied=new Map();
      for(let row=0;row<(node.content||[]).length;row++){
        let col=0;
        for(const cell of node.content[row].content||[]){
          while((occupied.get(col)||0)>row)col++;
          const span=[],colspan=cell.attrs?.colspan||1,rowspan=cell.attrs?.rowspan||1;
          if(colspan>1)span.push(`跨 ${colspan} 列`);
          if(rowspan>1)span.push(`跨 ${rowspan} 行`);
          addText(`${prefix}第 ${row+1} 行，第 ${col+1} 列${cell.type==='tableHeader'?'（表头）':''}${span.length?'（'+span.join('，')+'）':''}：`);
          for(const child of cell.content||[])walk(child,prefix,depth);
          for(let offset=0;offset<colspan;offset++)occupied.set(col+offset,row+rowspan);
          col+=colspan;
        }
      }
      addText(prefix+'表格结束');return;
    }
    if(node.type==='bulletList'||node.type==='orderedList'){let index=node.attrs?.start||1;for(const item of node.content||[]){const marker=node.type==='orderedList'?`${index++}. `:'• ';for(let i=0;i<(item.content||[]).length;i++){const child=item.content[i];walk(child,prefix+'  '.repeat(depth)+(i===0?marker:'  '),depth+1);}}return;}
    for(const child of node.content||[])walk(child,prefix,depth);
  }
  walk(doc);if(!blocks.length)throw new Error('评分内容为空。');return blocks;
}

export function prepareAiGrading(data,answer){
  if(!data||data.formatVersion!==1||!answer||answer.formatVersion!==1||!Number.isFinite(data.maxScore)||data.maxScore<=0||data.maxScore>100000||!Number.isInteger(data.maxScore*2))throw new Error('简答题评分数据无效。');
  return {protocolVersion:1,question:toAiBlocks(data.stem),answer:toAiBlocks(answer.document),referenceAnswer:toAiBlocks(data.referenceAnswer),rubric:toAiBlocks(data.rubric),maxScore:data.maxScore,scoreStep:0.5};
}
