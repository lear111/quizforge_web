// Reproducible code-native diagram and sample documents. This only writes the
// checked-in demo bank and extension examples, never practice state or history.
import {mkdir,writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
const width=640,height=220,pixels=Buffer.alloc(height*(width*4+1));
for(let y=0;y<height;y++){const offset=y*(width*4+1);pixels[offset]=0;for(let x=0;x<width;x++){const at=offset+1+x*4;pixels.set([250,248,254,255],at);}}
function pixel(x,y,color){if(x<0||y<0||x>=width||y>=height)return;pixels.set([...color,255],y*(width*4+1)+1+x*4);}
function rect(left,top,w,h,color){for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++)pixel(x,y,color);}
rect(35,65,140,90,[173,150,217]);rect(250,65,140,90,[133,181,164]);rect(465,65,140,90,[218,178,126]);
for(const left of [180,395]){rect(left,106,48,8,[139,124,160]);for(let d=0;d<18;d++)for(let j=-d;j<=d;j++)pixel(left+65-d,110+j,[139,124,160]);}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const name=Buffer.from(type),crcInput=Buffer.concat([name,data]);let crc=0xffffffff;for(const byte of crcInput)crc=crcTable[(crc^byte)&255]^(crc>>>8);const size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,name,data,checksum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const assetId=createHash('sha256').update(image).digest('hex');
const text=(value,marks)=>({type:'text',text:value,...(marks?{marks}:{} )});
const p=(...content)=>({type:'paragraph',...(content.length?{content}:{} )});
const doc=(...content)=>({type:'doc',content});
const bold=value=>text(value,[{type:'bold'}]);
const list=(...items)=>({type:'bulletList',content:items.map(value=>({type:'listItem',content:[p(text(value))]}))});
const questions=[
  {id:'short-answer-information-flow',title:'描述信息处理流程',data:{formatVersion:1,stem:doc(p(text('下图从左至右分别表示'),bold('输入、处理、输出'),text('。请用一个生活中的例子解释三个阶段，并说明处理阶段的作用。')),{type:'image',attrs:{assetId,alt:'三个色块用箭头连接，从左至右表示输入、处理和输出'}},p(text('答案中可以使用列表、加粗或插入图片。'))),referenceAnswer:doc(p(text('例如制作一杯果汁：输入是水果和水；处理是清洗、切块并搅拌；输出是一杯果汁。处理阶段把原始材料转换为满足需求的结果。'))),rubric:doc(list('给出合理的生活例子：1 分。','准确对应输入、处理、输出三个阶段：每阶段 1 分。','解释处理阶段的转换作用：1 分。')),maxScore:5}},
  {id:'short-answer-explain-cache',title:'解释缓存的作用与边界',data:{formatVersion:1,stem:doc({type:'heading',attrs:{level:2},content:[text('为什么第二次打开同一道题会更快？')]},p(text('请解释缓存如何减少加载时间，并列举一个需要更新缓存的场景。')),{type:'blockquote',content:[p(text('提示：考虑题目内容被编辑，以及浏览器保存的数据是否仍然有效。'))]}),referenceAnswer:doc(p(text('缓存保存已经读取的数据，再次访问时可以复用，减少网络传输和重复解析。题目被编辑后旧缓存可能过期，因此需要通过版本或修订号检查并更新。'))),rubric:doc(list('说明缓存复用已有数据，减少重复读取：2 分。','给出题目修改、状态改变等有效更新场景：1.5 分。')),maxScore:3.5}},
  {id:'short-answer-review-code',title:'阅读代码并解释行为',data:{formatVersion:1,stem:doc(p(text('阅读以下代码，解释输出结果，并说明'),bold('对象相等'),text('与'),bold('内容相等'),text('的区别。')),{type:'codeBlock',attrs:{language:'java'},content:[text('String a = new String("QuizForge");\nString b = new String("QuizForge");\nSystem.out.println(a == b);\nSystem.out.println(a.equals(b));')]}),referenceAnswer:doc(p(text('依次输出 false 和 true。== 比较两个引用是否指向同一对象，这里是两个分别创建的对象；String.equals 比较字符串内容，两者内容相同。'))),rubric:doc(list('正确写出两个输出：每个 1 分。','解释 == 比较引用：1 分。','解释 equals 比较字符串内容：1 分。')),maxScore:4}}
];
for(const directory of ['question-banks/short-answer-demo','extensions/short-answer']){const target=resolve(root,directory);await mkdir(resolve(target,'assets'),{recursive:true});await writeFile(resolve(target,'assets',`${assetId}.png`),image);}
await writeFile(resolve(root,'question-banks/short-answer-demo/bank.json'),JSON.stringify({id:'short-answer-demo',title:'简答与富文本练习',description:'富文本、图片、待评分与 0.5 分自评示例。',extension:{id:'quizforge.short-answer',version:'1.0.0'},questions},null,2)+'\n');
await writeFile(resolve(root,'extensions/short-answer/examples.json'),JSON.stringify({id:'examples',title:'简答题示例',description:'体验富文本作答、图片及提交后自评。',extension:{id:'quizforge.short-answer',version:'1.0.0'},questions},null,2)+'\n');
const nodeSchema={type:'object',additionalProperties:false,required:['type'],properties:{type:{enum:['doc','paragraph','heading','blockquote','bulletList','orderedList','listItem','codeBlock','hardBreak','horizontalRule','image','text']},text:{type:'string',maxLength:100000},attrs:{type:'object'},marks:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['type'],properties:{type:{enum:['bold','italic','strike','underline','code','link']},attrs:{type:'object'}}}},content:{type:'array',maxItems:5000,items:{$ref:'#/definitions/node'}}}};
const definitions={node:nodeSchema,document:{allOf:[{$ref:'#/definitions/node'},{type:'object',required:['type','content'],properties:{type:{const:'doc'},content:{type:'array',minItems:1}}}]}};
const schema={"$schema":"http://json-schema.org/draft-07/schema#",type:'object',additionalProperties:false,required:['formatVersion','stem','referenceAnswer','rubric','maxScore'],properties:{formatVersion:{const:1},stem:{$ref:'#/definitions/document'},referenceAnswer:{$ref:'#/definitions/document'},rubric:{$ref:'#/definitions/document'},maxScore:{type:'number',exclusiveMinimum:0,maximum:100000,multipleOf:0.5}},definitions};
await writeFile(resolve(root,'extensions/short-answer/question.schema.json'),JSON.stringify(schema,null,2)+'\n');
await writeFile(resolve(root,'extensions/short-answer/answer.schema.json'),JSON.stringify({...schema,required:['formatVersion','document'],properties:{formatVersion:{const:1},document:{$ref:'#/definitions/document'}}},null,2)+'\n');
process.stdout.write(`Demo assets: ${assetId}.png\n`);
