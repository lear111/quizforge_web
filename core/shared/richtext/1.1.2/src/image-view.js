import {NodeSelection} from "@tiptap/pm/state";
import {closeHistory} from "@tiptap/pm/history";
import {styleImage} from "./render.js";

// Width is the existing portable document attribute. Height always follows the image ratio.
export function imageView({node, getPos, editor, resources, isDisposed}) {
  const wrapper = document.createElement("div"), image = document.createElement("img");
  wrapper.className = "qfrt-image-view";
  wrapper.contentEditable = "false";
  image.className = "qfrt-image";
  image.draggable = false;
  wrapper.append(image);
  let live = true, assetId = null, version = 0, dragging = null;
  const position = () => {
    const value = getPos?.();
    return Number.isInteger(value) && editor.state.doc.nodeAt(value)?.type.name === "image" ? value : null;
  };
  const showWidth = value => {
    styleImage(wrapper, {...node.attrs, width:value});
    wrapper.style.width = value ? `${value}px` : "fit-content";
    styleImage(image, {...node.attrs, width:value});
    image.style.margin = "0";
  };
  const selectImage = (focus = true) => {
    const pos = position();
    if (pos === null || !live || isDisposed()) return false;
    editor.commands.setNodeSelection(pos);
    if (focus) editor.view.focus();
    return true;
  };
  const commit = value => {
    const pos = position();
    if (pos === null || !live || isDisposed() || value === node.attrs.width) return;
    const tr = closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {...node.attrs,width:value});
    tr.setSelection(NodeSelection.create(tr.doc,pos));
    editor.view.dispatch(tr);
    // Make each completed drag one undo step, separate from typing and the next drag.
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory",false));
  };
  const unlisten = () => {
    document.removeEventListener("pointermove",move,true);
    document.removeEventListener("pointerup",finish,true);
    document.removeEventListener("pointercancel",cancel,true);
    document.removeEventListener("keydown",escape,true);
    wrapper.classList.remove("is-resizing");
  };
  function move(event) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX-dragging.x)*dragging.horizontal;
    const dy = (event.clientY-dragging.y)*dragging.vertical*dragging.ratio;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    dragging.width = Math.max(24,Math.min(2400,Math.round(dragging.original+delta)));
    showWidth(dragging.width);
  }
  function finish(event) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    event.preventDefault();
    const value=dragging.width,capture=dragging;
    dragging=null;
    unlisten();
    try{capture.handle.releasePointerCapture?.(capture.pointerId);}catch{}
    commit(value);
    showWidth(node.attrs.width);
  }
  function cancel(event) {
    if (!dragging || event && event.pointerId !== dragging.pointerId) return;
    const capture=dragging;
    dragging=null;
    unlisten();
    try{capture.handle.releasePointerCapture?.(capture.pointerId);}catch{}
    showWidth(node.attrs.width);
  }
  function escape(event) {
    if (event.key !== "Escape" || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
  for (const [corner,horizontal,vertical] of [["nw",-1,-1],["ne",1,-1],["sw",-1,1],["se",1,1]]) {
    const handle=document.createElement("button");
    handle.type="button";
    handle.className=`qfrt-image-handle qfrt-image-handle-${corner}`;
    handle.setAttribute("aria-label","等比调整图片大小");
    handle.title="拖动调整图片大小；左右方向键微调";
    handle.addEventListener("pointerdown",event=>{
      if (event.button !== undefined && event.button !== 0 || !selectImage()) return;
      event.preventDefault();event.stopPropagation();
      cancel();
      const bounds=image.getBoundingClientRect();
      const original=bounds.width || node.attrs.width || image.naturalWidth || 320;
      const ratio=bounds.height>0 ? original/bounds.height : image.naturalHeight>0 ? image.naturalWidth/image.naturalHeight : 1;
      dragging={handle,pointerId:event.pointerId,x:event.clientX,y:event.clientY,horizontal,vertical,original,ratio,width:Math.round(original)};
      try{handle.setPointerCapture?.(event.pointerId);}catch{}
      wrapper.classList.add("is-resizing");
      document.addEventListener("pointermove",move,true);
      document.addEventListener("pointerup",finish,true);
      document.addEventListener("pointercancel",cancel,true);
      document.addEventListener("keydown",escape,true);
    });
    handle.addEventListener("keydown",event=>{
      if (!["ArrowLeft","ArrowRight"].includes(event.key) || !selectImage(false)) return;
      event.preventDefault();event.stopPropagation();
      const current=image.getBoundingClientRect().width || node.attrs.width || image.naturalWidth || 320;
      commit(Math.max(24,Math.min(2400,Math.round(current+(event.key==="ArrowRight"?1:-1)*(event.shiftKey?1:10)))));
    });
    handle.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();});
    handle.addEventListener("lostpointercapture",cancel);
    wrapper.append(handle);
  }
  const load = value => {
    node=value;
    image.dataset.assetId=value.attrs.assetId;
    image.alt=value.attrs.alt||"图片";
    image.title=value.attrs.title||"";
    if (!dragging) showWidth(value.attrs.width);
    if (assetId===value.attrs.assetId) return;
    assetId=value.attrs.assetId;
    const token=++version, requestedId=assetId;
    image.removeAttribute("src");
    Promise.resolve().then(()=>resources?.get(requestedId)).then(asset=>{
      if (live&&!isDisposed()&&token===version) {
        if (!asset || typeof asset.url!=="string") throw new Error("图片资源无效");
        image.src=asset.url;
      }
    }).catch(()=>{
      if(live&&!isDisposed()&&token===version) image.alt="图片无法加载";
    });
  };
  image.addEventListener("click",event=>{event.preventDefault();selectImage();});
  load(node);
  return {dom:wrapper,selectNode(){wrapper.classList.add("ProseMirror-selectednode");},deselectNode(){wrapper.classList.remove("ProseMirror-selectednode");cancel();},
    update(value){if(value.type.name!=="image")return false;load(value);return true;},
    stopEvent:event=>event.target.closest?.(".qfrt-image-handle") || event.type==="click"&&event.target===image,
    ignoreMutation:()=>true,
    destroy(){live=false;version++;cancel();image.removeAttribute("src");}
  };
}
