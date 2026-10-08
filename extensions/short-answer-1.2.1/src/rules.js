import {validateDocument} from '../../../shared/richtext/1.1.1/src/document.js';
import {prepareAiGrading} from './ai-document.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const half=value=>Number.isFinite(value)&&Number.isInteger(value*2);
QF.defineType({
  prepareAiGrading,
  validateQuestion(data){return object(data)&&data.formatVersion===1&&half(data.maxScore)&&data.maxScore>0&&data.maxScore<=100000&&['stem','referenceAnswer','rubric'].every(key=>validateDocument(data[key],{requireContent:true}));},
  validateAnswer(answer){return object(answer)&&answer.formatVersion===1&&validateDocument(answer.document);},
  project(data,context){const value={formatVersion:1,stem:data.stem,maxScore:data.maxScore};if(context?.submitted){value.referenceAnswer=data.referenceAnswer;value.rubric=data.rubric;}return value;},
  grade(data,answer){if(!validateDocument(answer.document,{requireContent:true}))throw new Error('请先填写答案。');return {gradingStatus:'pending',score:null,maxScore:data.maxScore,correct:null,feedback:null};},
  review(data,answer,review){if(!validateDocument(answer.document,{requireContent:true})||!object(review)||!half(review.score)||review.score<0||review.score>data.maxScore||Object.keys(review).some(key=>!['score','feedback'].includes(key))||review.feedback!==undefined&&(typeof review.feedback!=='string'||review.feedback.length>20000))throw new Error('评分应在 0 至本题满分之间，以 0.5 分为单位。');return {gradingStatus:'graded',score:review.score,maxScore:data.maxScore,correct:review.score===data.maxScore,feedback:review.feedback??null};},
  getScore(data,state){if(!state?.submitted&&state?.status!=='submitted')return {score:0,maxScore:data.maxScore,gradingStatus:'unsubmitted'};return {score:state.result?.gradingStatus==='pending'?null:state.result?.score,maxScore:data.maxScore,gradingStatus:state.result?.gradingStatus||'graded'};}
});
