import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { selectBattery } from '../services/pm/proposalEngine/batterySelector.js';
import { loadCatalogueFromDb } from '../services/pm/proposalEngine/catalogue/dbLoader.js';
import { COMPATIBILITY, BMS_RULES } from '../services/pm/proposalEngine/data/engineeringRules.js';
for(const l of fs.readFileSync('.env','utf8').split('\n')){const t=l.trim();if(!t||t[0]==='#'||!t.includes('='))continue;const i=t.indexOf('=');process.env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
let pass=0,fail=0;const check=(l,c,h='')=>{console.log(`  ${c?'✓':'✗'} ${l}${c?'':'  — '+h}`);c?pass++:fail++;};
const cat=await loadCatalogueFromDb(sb);
const primo={...cat.INVERTERS['FRN-INV-100-G24P-1P'],sku:'FRN-INV-100-G24P-1P'};
console.log('Primo has compatible_batteries:',Array.isArray(primo.compatible_batteries),'('+primo.compatible_batteries?.length+')');
// small target 8 kWh on Primo → must NOT pick HVM 8.3 (3 mod); should size up to a valid pairing
const r=selectBattery({targetUsableKwh:8,inverter:primo,catalogue:cat,COMPATIBILITY,BMS_RULES});
console.log('  picked:',r.sku,'series',r.battery?.series||r.series,'x'+r.module_count,'=',r.total_usable_kwh,'kWh');
const cap=(r.module_count||0)*(cat.BATTERIES[r.sku]?.module_kwh||0);
const approved=(primo.compatible_batteries||[]).some(c=>c.is_compatible&&c.family===(r.series||cat.BATTERIES[r.sku]?.series)&&Math.abs(c.capacity_kwh-cap)<=0.6);
check('Primo small-target pick is an APPROVED matrix pairing',approved,'cap='+cap.toFixed(1));
check('did NOT pick a 3-module HVM (the old bug)',!(/HVM/.test(r.series||cat.BATTERIES[r.sku]?.series||'')&&r.module_count===3),'mc='+r.module_count);
// legacy fallback: inverter without compatible_batteries → still returns a battery
const noMatrix={...primo,compatible_batteries:null};
const r2=selectBattery({targetUsableKwh:8,inverter:noMatrix,catalogue:cat,COMPATIBILITY,BMS_RULES});
check('legacy fallback (no matrix) still returns a battery',!!r2.sku,'reason='+r2.reason_code);
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
