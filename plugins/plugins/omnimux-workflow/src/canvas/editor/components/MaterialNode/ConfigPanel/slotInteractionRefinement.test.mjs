import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zh from '../../../../i18n/dict.zh.ts';
import en from '../../../../i18n/dict.en.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const result = await build({
 stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import SlotWells from ${JSON.stringify(resolve(here,'SlotWells/SlotWells.tsx'))}; export const render = props => renderToStaticMarkup(React.createElement(SlotWells,props));`, resolveDir: root },
 bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'silent', nodePaths: (process.env.NODE_PATH ?? '').split(':').filter(Boolean),
 plugins: [{name:'slot-i18n',setup(build) {
  build.onResolve({filter:/\/i18n$/},()=>({path:'i18n',namespace:'slot-test'}));
  build.onLoad({filter:/.*/,namespace:'slot-test'},()=>({contents:`import zh from ${JSON.stringify(resolve(root,'src/canvas/i18n/dict.zh.ts'))}; export const useT=()=>key=>zh[key]??key;`,loader:'ts',resolveDir:root}));
 }}],
});
const mod = {exports:{}};
new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {render} = mod.exports;
const spec = {slot:'refs',type:'image',role:'reference',min:0,max:2,labelKey:'panel.slot.reference_image'};
const props = {layout:{preset:'strip',slots:[spec],addButton:true},bindings:{refs:[{edgeId:'e',sourceNodeId:'image'}]},upstreams:[{edgeId:'e',nodeId:'image',label:'portrait.png',materialType:'image',availability:'ready',hasMedia:true,url:'https://example.test/portrait.png'}],onPickSlot(){},onClearOccupant(){},onInsertToken(){}};

test('slot renders accessible filled media and add control without native file title or dynamic geometry',()=>{
 const html=render(props);
 assert.match(html,/src="https:\/\/example.test\/portrait.png"/);
 assert.match(html,/aria-label="portrait.png"/);
 assert.match(html,/data-slot-state="filled"/);
 assert.match(html,/wf-slot-well--append/);
 assert.doesNotMatch(html,/title="portrait.png"|aspect-ratio|wf-slot-well__label/);
});
test('missing and waiting outputs render honest states rather than valid image previews',()=>{
 const waiting=render({...props,upstreams:[{...props.upstreams[0],availability:'waiting',hasMedia:false}]});
 const missing=render({...props,upstreams:[]});
 assert.match(waiting,/wf-slot-well__placeholder--loading/); assert.doesNotMatch(waiting,/<img/);
 assert.match(missing,/wf-slot-well__placeholder--broken/); assert.doesNotMatch(missing,/<img/);
});
test('empty and full strips preserve model capacity affordances',()=>{
 const empty=render({...props,bindings:{}});
 assert.doesNotMatch(empty,/data-slot-state="filled"/); assert.match(empty,/wf-slot-well--append/);
 const full=render({...props,layout:{...props.layout,slots:[{...spec,max:1}]}});
 assert.doesNotMatch(full,/wf-slot-well--append/);
});
test('image and audio add controls carry distinct slot identities on both canvas versions', () => {
 const images = {...spec, slot:'reference_images', min:1};
 const audio = {...spec, slot:'reference_audios', type:'audio', labelKey:'panel.slot.reference_audios'};
 const layout = {preset:'strip', operationId:'video_multi_ref', outputType:'video', slots:[images, audio], addButton:true};
 for (const records of [undefined, []]) {
  const html = render({...props, layout, bindings:{}, records});
  const addButtons = [...html.matchAll(/<button[^>]*data-testid="wf-add-reference"[^>]*>/g)].map(([tag]) => tag);
  assert.equal(addButtons.length, 2, 'unsatisfied required image slot renders alongside one unified add button');
  assert.match(addButtons[0], /data-slot="reference_images" data-slot-role="reference"/);
  assert.match(addButtons[0], /wf-slot-well--required/);
  assert.doesNotMatch(addButtons[1], /data-slot="/);
  assert.match(addButtons[1], /data-slot-role="reference"/);
  assert.doesNotMatch(html, /data-slot="reference_audios"/, 'optional audio slot must not render a dedicated empty well');
  assert.ok(addButtons.every(button => button.includes('aria-label=') && !button.includes('disabled')));
  const allOptional = render({...props, layout:{...layout, slots:[{...images, min:0}, audio]}, bindings:{}, records});
  const optionalButtons = [...allOptional.matchAll(/<button[^>]*data-testid="wf-add-reference"[^>]*>/g)].map(([tag]) => tag);
  assert.equal(optionalButtons.length, 1, 'all-optional multi-type references collapse into a single generic add button');
  assert.doesNotMatch(allOptional, /wf-slot-well__position/);
  const borrowed = render({...props, layout:{...layout, displayOnlyFromOperation:'video_multi_ref'}, bindings:{}, records});
  assert.doesNotMatch(borrowed, /data-testid="wf-add-reference"/);
  assert.equal(render({...props, layout:{...layout, operationId:'text_to_video', slots:[]}, records}), '');
 }
});
test('mixed reference cards follow the projected input order across types', () => {
 const audio = {...spec, slot:'audio', type:'audio', labelKey:'panel.slot.reference_audios'};
 const sound = {edgeId:'sound-edge', sourceNodeId:'sound'};
 const image = props.bindings.refs[0];
 const records = [{slot:audio, occupant:sound, state:'ready'}, {slot:spec, occupant:image, state:'ready'}];
 const html = render({...props, layout:{...props.layout, slots:[spec, audio]}, records});
 assert.match(html,/data-slot-edge="sound-edge"[\s\S]*data-slot-edge="e"/);
});
test('replacement and reference grouping labels cover both locales',()=>{
 assert.equal(zh['node.replaceMaterial'],'替换素材'); assert.equal(en['node.replaceMaterial'],'Replace asset');
 for(const key of ['mention.current','mention.canvas','mention.waiting','mention.unavailable','mention.noMatches']) { assert.ok(zh[key]);assert.ok(en[key]); }
});
test('input_unavailable 记录不再渲染常驻裸「不可用」，但保留裂图占位（Issue #4032）',()=>{
 const promptSpec = {slot:'prompt',type:'text',role:'prompt',min:1,max:1,labelKey:'panel.slot.prompt'};
 const html = render({
  layout:{preset:'strip',slots:[promptSpec],addButton:false},
  bindings:{prompt:[{edgeId:'e-dead',sourceNodeId:'gone'}]},
  upstreams:[],
  records:[{slot:promptSpec,occupant:{edgeId:'e-dead',sourceNodeId:'gone'},state:'invalid',reasonCode:'input_unavailable'}],
  onPickSlot(){},onClearOccupant(){},onInsertToken(){},
 });
 assert.match(html,/wf-slot-well__placeholder--broken/);
 assert.doesNotMatch(html,/wf-slot-well__state/);
 assert.doesNotMatch(html,/不可用/);
});
test('a composed text binding with a role conflict remains available for replacement', () => {
 const prompt = {slot:'prompt', type:'text', role:'prompt', min:1, max:1, labelKey:'panel.slot.prompt',
  composition:{kind:'content_with_instruction', localRole:'instruction'}};
 const occupant = {edgeId:'replaced', sourceNodeId:'source'};
 const html = render({
  ...props, layout:{preset:'strip', outputType:'text', slots:[prompt], addButton:false},
  records:[{slot:prompt, occupant, state:'invalid', reasonCode:'role_conflict'}],
 });
 assert.match(html, /class="wf-slot-well wf-slot-well--filled" role="button" tabindex="0" data-slot="prompt" data-slot-role="prompt" data-slot-edge="replaced" data-slot-state="invalid"/);
 assert.doesNotMatch(html, /wf-prompt-references|wf-prompt-reference/);
});
test('任何槽位状态都不再渲染卡槽下方常驻文案（Issue #4048）',()=>{
 const imageSpec = {slot:'reference_images',type:'image',role:'reference',min:0,max:1,labelKey:'panel.slot.reference_image'};
 const base = {layout:{preset:'strip',slots:[imageSpec],addButton:false},
  bindings:{reference_images:[{edgeId:'e1',sourceNodeId:'src'}]},
  upstreams:[{edgeId:'e1',nodeId:'src',label:'img',materialType:'image',availability:'ready',hasMedia:true,url:'https://example.test/x.png'}],
  onPickSlot(){},onClearOccupant(){},onInsertToken(){}};
 for (const state of ['invalid','inactive','pending']) {
  const html = render({...base, records:[{slot:imageSpec,occupant:{edgeId:'e1',sourceNodeId:'src'},state,reasonCode: state==='invalid'?'role_conflict':undefined}]});
  assert.doesNotMatch(html,/wf-slot-well__state/, `${state}: 不得渲染常驻状态节点`);
  for (const word of ['不兼容','不可用','等待中','未使用','无效']) assert.doesNotMatch(html,new RegExp(word), `${state}: 不得出现「${word}」`);
 }
});
