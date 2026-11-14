import test from "node:test";
import assert from "node:assert/strict";
import { IndictmentParser, counselText } from "../src/core.js";
const doc = text => ({
  text, usedOCR:false,
  pages:[{ text, height:842, lines:text.split("\n").map((text,i)=>({ text, y:i*12 })) }]
});
test("single defendant stops before criminal facts and ignores other persons", () => {
 const d=IndictmentParser.parse(doc(
  "2026. 11. 13.\n검 사 이정현 (서명)\nI. 피고인 관련사항\n피고인 김민수 (900101-1234567)\n죄명 상해\n구속여부 불구속\n변호인 없음\nII. 공소사실\n1. 피고인 박가상은 피해자와\n2. 피고인 이가상은..."
 ));
 assert.equal(d.defendants.length,1);
 assert.equal(d.defendants[0].name,"김민수");
 assert.deepEqual(d.defendants[0].charges,["상해"]);
 assert.equal(d.prosecutor,"이정현");
});
test("prosecutor supports separate signature line",()=>{
 const d=IndictmentParser.parse(doc("2026.11.13.\n검 사\n이정현 (서명)\n피고인 김민수 (900101-1234567)\n죄명 상해\n구속여부 불구속\n변호인 없음"));
 assert.equal(d.prosecutor,"이정현");
});
test("legal aid counsel is normalized to name(국선)",()=>{
 const d=IndictmentParser.parse(doc("피고인 김민수 (900101-1234567)\n죄명 상해\n구속여부 불구속\n변호인 국선변호사 이정현\nII. 공소사실"));
 assert.equal(counselText(d),"이정현(국선)");
});
test("already normalized counsel stays named",()=>{
 const d=IndictmentParser.parse(doc("피고인 김민수 (900101-1234567)\n변호인 윤상일(국선)\nII. 공소사실"));
 assert.equal(counselText(d),"윤상일(국선)");
});
test("law firm plus multiple attorneys are compacted",()=>{
 const d=IndictmentParser.parse(doc("피고인 김민수 (900101-1234567)\n변호인 법무법인 태평양\n담당변호사 이정현 이승엽 이인우 이재돈 권영옥\nII. 공소사실"));
 assert.equal(counselText(d),"태평양) 이정현,이승엽,이인우,이재돈,권영옥");
});
test("second defendant only from explicit identity fields",()=>{
 const d=IndictmentParser.parse(doc("피고인 김민수 (900101-1234567)\n죄명 상해\n피고인 이가상 (910101-1234567)\n죄명 절도\nII. 공소사실\n피고인 박가상"));
 assert.deepEqual(d.defendants.map(p=>p.name),["김민수","이가상"]);
});
