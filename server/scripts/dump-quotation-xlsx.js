// One-shot reader to inspect the user's existing quotation Excel structure.
// Reads from Downloads, dumps every sheet's structure + a sample of rows.

import xlsx from 'xlsx';
import path from 'node:path';
import os from 'node:os';

const file = path.join(os.homedir(), 'Downloads', 'Goldenray_Final_Detailed_Quotation.xlsx');
const wb = xlsx.readFile(file);

console.log(`\n📄 ${file}\n`);
console.log(`Workbook has ${wb.SheetNames.length} sheet(s):\n`);

for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const ref   = sheet['!ref'] || '';
  const range = ref ? xlsx.utils.decode_range(ref) : null;

  console.log(`─── Sheet: "${name}" ───`);
  if (range) {
    console.log(`   Range: ${ref}  (${range.e.r - range.s.r + 1} rows × ${range.e.c - range.s.c + 1} cols)`);
  }

  // Get as 2D array for raw inspection (preserves formulas as resolved values)
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`   Total rows: ${rows.length}`);

  // Dump every row with cell references so we see the structure
  rows.forEach((row, i) => {
    const trimmed = row.map(c => String(c).trim());
    const allEmpty = trimmed.every(c => c === '');
    if (allEmpty) {
      console.log(`   R${i+1}: (empty)`);
    } else {
      // Show columns up to last non-empty
      const lastNonEmpty = trimmed.length - 1 - [...trimmed].reverse().findIndex(c => c !== '');
      const cells = trimmed.slice(0, lastNonEmpty + 1).map((v, j) => `${String.fromCharCode(65 + j)}=${JSON.stringify(v).slice(0, 80)}`);
      console.log(`   R${i+1}: ${cells.join(' | ')}`);
    }
  });

  console.log('');
}
