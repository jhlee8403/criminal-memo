// Measured printed-label rectangles in the original first page (top-down pt).
export const markTextRects = Object.freeze({
  juvenile: Object.freeze([206.288193, 493.33429, 19.90921, 9.951874]),
  jury: Object.freeze([206.288193, 513.352417, 19.90921, 9.951843]),
});
const centered = ([x,y,w,h], width, height) => [x+(w-width)/2, y+(h-height)/2, width, height];
export const markFitRects = Object.freeze({
  // Keeps a gap to 집유결격자/필요적국선, the other mark, and the table lines.
  juvenile: Object.freeze(centered(markTextRects.juvenile, 36, 14)),
  jury: Object.freeze(centered(markTextRects.jury, 26, 14)),
});

// Fontkit bounds describe the actual O/X outlines, not ascender/descender boxes.
// Read the same embedded font that the PDF renderer uses; no new font asset.
export function markFontMetrics(font) {
  const glyphs = {};
  for (const text of ['O','X']) {
    const glyph=font.glyphForCodePoint(text.codePointAt(0));
    const {minX,minY,maxX,maxY}=glyph.bbox;
    glyphs[text]={advance:glyph.advanceWidth,minX,minY,maxX,maxY};
  }
  return {unitsPerEm:font.unitsPerEm,glyphs};
}

export function fitOverlayMarks(items, textRect, fitRect, metrics) {
  if(items.some(g=>!['O','X',' '].includes(g.text)))throw Error('O/X 또는 빈칸만 표시할 수 있습니다.');
  const visible=items.filter(g=>g.text!==' ');
  if(!visible.length)return {fontSize:0,xScale:1,runs:[]};
  const {unitsPerEm:units,glyphs}=metrics;
  const slot=Math.max(glyphs.O.advance,glyphs.X.advance);
  const inkWidth=Math.max(...visible.map(g=>glyphs[g.text].maxX-glyphs[g.text].minX));
  const inkHeight=Math.max(...visible.map(g=>glyphs[g.text].maxY-glyphs[g.text].minY));
  // Equal slots retain unknown defendants at the beginning/middle/end.
  const edgeWidth=item=>item.text===' '?inkWidth:glyphs[item.text].maxX-glyphs[item.text].minX;
  const leftWidth=edgeWidth(items[0]),rightWidth=edgeWidth(items[items.length-1]);
  const span=(items.length-1)*slot+(leftWidth+rightWidth)/2;
  const centerShift=(leftWidth-rightWidth)/4;
  const fontSize=Math.min(fitRect[2]*units/span,fitRect[3]*units/inkHeight);
  // A single normal-width Latin glyph cannot cover two Korean characters.
  // Expand only that glyph horizontally to the printed word's width.
  const xScale=items.length===1?Math.max(1,Math.min(textRect[2],fitRect[2])/(inkWidth*fontSize/units)):1;
  const cx=textRect[0]+textRect[2]/2,cy=textRect[1]+textRect[3]/2;
  const runs=[];
  items.forEach((item,index)=>{
    if(item.text===' ')return;
    const m=glyphs[item.text];
    const centerX=cx+((index-(items.length-1)/2)*slot+centerShift)*fontSize/units*xScale;
    const width=(m.maxX-m.minX)*fontSize/units*xScale;
    const height=(m.maxY-m.minY)*fontSize/units;
    runs.push({...item,index,
      x:centerX-(m.minX+m.maxX)/2*fontSize/units*xScale,
      // Top-down baseline makes each actual outline center match the label.
      baseline:cy+(m.minY+m.maxY)/2*fontSize/units,
      inkRect:[centerX-width/2,cy-height/2,width,height],
    });
  });
  return {fontSize,xScale,runs};
}
