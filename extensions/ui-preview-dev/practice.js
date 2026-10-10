// UI-only example: no QF SDK, network request or stored answer.
const $=selector=>document.querySelector(selector);
const sample=globalThis.QF_PREVIEW?.question;
if(sample?.title)$('#stem').textContent=sample.title;
if(typeof sample?.data?.stem==='string')$('#prompt').textContent=sample.data.stem;
const choices=[...document.querySelectorAll('.choice')];
const update=()=>{
  for(const choice of choices)choice.classList.toggle('selected',choice.querySelector('input').checked);
  $('#submit').disabled=!document.querySelector('input[name="answer"]:checked');
  $('#answer-status').textContent='已选择';
};
choices.forEach(choice=>choice.querySelector('input').addEventListener('change',update));
$('#submit').addEventListener('click',()=>{
  const selected=document.querySelector('input[name="answer"]:checked');if(!selected)return;
  $('#feedback').hidden=false;$('#result').textContent=selected.value==='B'?'示例：回答正确':'示例：需要再想一想';
  choices.forEach(choice=>choice.querySelector('input').disabled=true);
  $('#submit').hidden=true;$('#reset').hidden=false;$('#answer-status').textContent='已提交 · 界面演示';
});
$('#reset').addEventListener('click',()=>{
  choices.forEach(choice=>{const input=choice.querySelector('input');input.disabled=false;input.checked=false;choice.classList.remove('selected');});
  $('#feedback').hidden=true;$('#submit').hidden=false;$('#submit').disabled=true;$('#reset').hidden=true;$('#answer-status').textContent='未作答';
});
