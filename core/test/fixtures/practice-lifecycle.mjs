import {JSDOM} from 'jsdom';
import {loadVueUi} from './vue-ui.mjs';

export function loadPracticeLifecycle(t){
  const dom=new JSDOM('',{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());
  return dom.window.QuizForgeUI.createPracticeLifecycle({start(){},finish(){},error(){},status(){}});
}
