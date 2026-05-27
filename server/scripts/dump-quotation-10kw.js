// Dump the Goldenray_Final_Detailed_Quotation_10kw.xlsx so we can compare
// it against the mockup proposal PDF prices.

import xlsx from 'xlsx';

const XLSX_PATH = 'C:\\Users\\ram33\\Downloads\\Goldenray_Final_Detailed_Quotation_10kw.xlsx';

const wb = xlsx.readFile(XLSX_PATH);
console.log('Sheets:', wb.SheetNames);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Sheet: ${name}   (${rows.length} rows)`);
  console.log(`══════════════════════════════════════════════════════════════`);
  rows.forEach((r, i) => {
    const compact = r.map(c => String(c).trim().slice(0, 70)).join(' | ');
    if (compact.replace(/[\s|]/g, '').length > 0) {
      console.log(String(i + 1).padStart(3), compact);
    }
  });
}
