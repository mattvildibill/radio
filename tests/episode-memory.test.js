import {test} from 'node:test';
import assert from 'node:assert/strict';
import {episodeMemory} from '../site/assets/episode-memory.js';
test('continuation preserves opening, joins spoken fragments and retains listener requests',()=>{
 const entry=(host,delta,onAir=true)=>({host,delta,onAir,type:'session.output_transcript.delta'});
 const memory=episodeMemory([entry('Mara','I like '),entry('Mara','Alien.'),entry('Eli','Same here.'),entry('Mara','Hidden',false),entry('Mara','What about comedy?')],[{type:'followup-delivered',text:'No spoilers'}]);
 assert.ok(memory.includes('Mara: I like Alien.'));assert.ok(memory.includes('What about comedy?'));assert.ok(memory.includes('No spoilers'));assert.ok(!memory.includes('Hidden'));
});
