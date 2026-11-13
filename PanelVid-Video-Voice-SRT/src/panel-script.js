// TXT cues use the same [TRANG n]/[PAGE n] marker convention as SRT. A marker
// is written on its own line before that page's panel text; it is not spoken.
// Blank-line-separated paragraphs are cues; without blank lines each text line
// is one cue. With no page markers, the legacy order-only file format remains.
export function parsePanelScriptDocumentTXT(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { cues: [], pageMarked: false };
  const lines = text.split('\n');
  const pageMarked = lines.some(line => /^\s*\[(?:TRANG|PAGE)\s+\d+\]/i.test(line));
  const sections = [];
  let currentPage = null, currentLines = [];
  const flushSection = () => { if (currentLines.length) sections.push({ page: currentPage, lines: currentLines }); currentLines = []; };
  for (const line of lines) {
    const marker = /^\s*\[(?:TRANG|PAGE)\s+(\d+)\]\s*(.*)$/i.exec(line);
    if (marker) {
      flushSection();
      currentPage = Number(marker[1]);
      if (marker[2].trim()) currentLines.push(marker[2].trim());
    } else currentLines.push(line);
  }
  flushSection();
  const cues = [];
  for (const section of sections) {
    let sectionLines = section.lines.slice();
    while (sectionLines.length && !sectionLines[0].trim()) sectionLines.shift();
    while (sectionLines.length && !sectionLines.at(-1).trim()) sectionLines.pop();
    const paragraphMode = sectionLines.some(line => !line.trim());
    const groups = paragraphMode ? sectionLines.join('\n').split(/\n\s*\n+/) : sectionLines.filter(line => line.trim());
    for (const group of groups) {
      const cueText = group.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
      if (cueText) cues.push({ text: cueText, page: section.page });
    }
  }
  return { cues, pageMarked };
}

export function parsePanelScriptTXT(raw) {
  return parsePanelScriptDocumentTXT(raw).cues.map(cue => cue.text);
}

export function bindPanelScriptToScenes(scenes, cues, pageCount, pageMarked) {
  const list=Array.isArray(scenes)?scenes:[],script=Array.isArray(cues)?cues:[];
  const bindings=Array(list.length).fill(null),pages=Math.max(0,Math.round(Number(pageCount)||0));
  if(!script.length)return{bindings,error:'File TXT không có nội dung.'};
  if(!pageMarked){
    if(script.length!==list.length)return{bindings,error:`TXT có ${script.length} đoạn nhưng hiện có ${list.length} panel. Cần đúng một đoạn cho mỗi panel.`};
    return{bindings:script.map((_,index)=>index),error:null};
  }
  if(script.some(cue=>!Number.isInteger(cue.page)))return{bindings,error:'Đã dùng mốc trang trong TXT thì phải đặt [TRANG n] trước phần lời của từng trang.'};
  // Flat chapter imports have one logical group in the legacy workspace even
  // though each image is a separate scene. In that case numbered TXT markers
  // address scenes directly (one panel per [TRANG n]), not that single group.
  if(pages===1&&list.length>1&&script.every(cue=>cue.page>=1&&cue.page<=list.length)){
    if(script.some((cue,index)=>index>0&&cue.page<script[index-1].page))return{bindings,error:'Các mốc [TRANG n] trong TXT phải theo thứ tự trang tăng dần để lời đọc khớp video.'};
    const cuesByScene=new Map();
    script.forEach((cue,cueIndex)=>{const indices=cuesByScene.get(cue.page-1)||[];indices.push(cueIndex);cuesByScene.set(cue.page-1,indices);});
    for(const [sceneIndex,indices] of cuesByScene){
      if(indices.length!==1)return{bindings,error:`Trang ${sceneIndex+1}: TXT có ${indices.length} đoạn nhưng ảnh có 1 panel. Cần đúng một đoạn cho mỗi panel của trang có mốc.`};
      bindings[sceneIndex]=indices[0];
    }
    return{bindings,error:null};
  }
  if(script.some(cue=>cue.page<1||cue.page>pages))return{bindings,error:`Mốc [TRANG n] trong TXT vượt quá số trang hiện có (${pages}).`};
  if(script.some((cue,index)=>index>0&&cue.page<script[index-1].page))return{bindings,error:'Các mốc [TRANG n] trong TXT phải theo thứ tự trang tăng dần để lời đọc khớp video.'};
  const cuesByPage=new Map();
  script.forEach((cue,panelIndex)=>{const indices=cuesByPage.get(cue.page)||[];indices.push(panelIndex);cuesByPage.set(cue.page,indices);});
  for(const [page,indices] of cuesByPage){
    const sceneIndices=list.map((scene,index)=>(Number.isInteger(scene.groupIndex)?scene.groupIndex:scene.pageIndex)===page-1?index:-1).filter(index=>index>=0);
    if(indices.length!==sceneIndices.length)return{bindings,error:`Trang ${page}: TXT có ${indices.length} đoạn nhưng ảnh có ${sceneIndices.length} panel. Cần đúng một đoạn cho mỗi panel của trang có mốc.`};
    sceneIndices.forEach((sceneIndex,index)=>{bindings[sceneIndex]=indices[index];});
  }
  return{bindings,error:null};
}

// Validate the scene-to-cue mapping before export. Unmarked pages/scenes are
// intentionally allowed for page-marked TXT and are omitted by the renderer.
export function isPanelScriptBindingValid(scenes, cues, pageMarked) {
  const list=Array.isArray(scenes)?scenes:[],script=Array.isArray(cues)?cues:[];
  if(!list.length||!script.length)return false;
  const mapped=list.map((scene,index)=>({scene,index,cueIndex:scene.panelScriptIndex})).filter(item=>Number.isInteger(item.cueIndex));
  if(mapped.length!==script.length)return false;
  const indices=mapped.map(item=>item.cueIndex);
  if(new Set(indices).size!==indices.length||indices.some(index=>index<0||index>=script.length))return false;
  if(indices.some((index,position)=>index!==position))return false;
  if(!pageMarked)return mapped.length===list.length&&mapped.every(item=>item.index===item.cueIndex);

  const pageIndices=list.map(scene=>Number.isInteger(scene.groupIndex)?scene.groupIndex:(Number.isInteger(scene.pageIndex)?scene.pageIndex:0));
  const pageCount=new Set(pageIndices).size;
  if(pageCount===1&&list.length>1){
    return mapped.every(item=>Number.isInteger(script[item.cueIndex].page)&&script[item.cueIndex].page===item.index+1);
  }
  const scenePageCounts=new Map(),cuePageCounts=new Map();
  pageIndices.forEach(page=>scenePageCounts.set(page,(scenePageCounts.get(page)||0)+1));
  script.forEach(cue=>{
    if(!Number.isInteger(cue.page)||cue.page<1||cue.page>pageCount)return;
    cuePageCounts.set(cue.page-1,(cuePageCounts.get(cue.page-1)||0)+1);
  });
  if(script.some(cue=>!Number.isInteger(cue.page)||cue.page<1||cue.page>pageCount))return false;
  for(const [page,count] of cuePageCounts){if(scenePageCounts.get(page)!==count)return false;}
  return mapped.every(item=>script[item.cueIndex].page===pageIndices[item.index]+1);
}

export function panelCueDurationsMap(scenes, cueDurations) {
  const list = Array.isArray(scenes) ? scenes : [];
  const durations = Array.isArray(cueDurations) ? cueDurations : [];
  if (!list.length || !durations.length || durations.some(value => !(Number(value) > 0))) return null;
  const result = new Map();
  let indices = list.map((scene, i) => Number.isInteger(scene.panelScriptIndex) ? scene.panelScriptIndex : (list.length === durations.length ? i : null));
  indices = indices.filter(Number.isInteger);
  if (indices.length !== durations.length || new Set(indices).size !== indices.length || indices.some(index => index < 0 || index >= durations.length)) return null;
  for (const scene of list) {
    const index = Number.isInteger(scene.panelScriptIndex) ? scene.panelScriptIndex : (list.length === durations.length ? list.indexOf(scene) : null);
    if (Number.isInteger(index)) result.set(scene.id, Number(durations[index]));
  }
  return result;
}
