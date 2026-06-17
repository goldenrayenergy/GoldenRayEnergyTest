// Page — Recommended tariff (post-install)
//
// Surfaces the bill_analyses.switch_recommended retailer/plan and the
// projected annual saving. Only renders when the bill engine actually
// recommended a switch — silent otherwise.

import { pageHead, pageFoot } from '../_shared.js';
import { fmt$ } from '../proposalData.js';

export function pageTariffRecommendation(d, sectionNum, sectionsTotal) {
  const t = d.insights?.tariff;
  if (!t) return '';

  const savingPerYear = Number(t.annual_saving || 0);
  const saving25yr = Math.round(savingPerYear * 25 * 1.07);  // simple compounding ~7%

  const currentPlan = t.current_plan ? `${t.current_retailer} <span style="color:#5C6470">— ${t.current_plan}</span>`
    : (t.current_retailer || 'Current retailer');
  const recommendedPlan = t.switch_to_plan
    ? `${t.switch_to_retailer} <span style="color:#5C6470">— ${t.switch_to_plan}</span>`
    : t.switch_to_retailer;

  return `<section class="page">
    ${pageHead(d, 'Recommended tariff (post-install)')}

    <div class="page-content-grow">
      <p style="font-size:11px;color:#5C6470;margin:0 0 16px">
        Solar generation doesn't just lower your bill — it changes the SHAPE of your usage.
        That means a different retailer or plan often becomes the better fit. Based on the
        usage profile in your bills, the engine flagged a switch worth considering.
      </p>

      <div style="display:grid;grid-template-columns:1fr 30px 1fr;gap:14px;align-items:stretch;margin-bottom:18px">
        <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:6px;padding:14px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5C6470;font-weight:700;margin-bottom:4px">
            You're on now
          </div>
          <div style="font-size:14px;font-weight:700;color:#0B0F1A;line-height:1.3">
            ${currentPlan}
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;font-size:24px;color:#FF6A00">→</div>
        <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;padding:14px">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#7C2D12;font-weight:700;margin-bottom:4px">
            Recommended (post-install)
          </div>
          <div style="font-size:14px;font-weight:700;color:#7C2D12;line-height:1.3">
            ${recommendedPlan}
          </div>
        </div>
      </div>

      <div style="background:#F0FDF4;border-left:4px solid #16A34A;padding:14px;border-radius:4px;margin-bottom:14px">
        <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:#14532D;font-weight:700;margin-bottom:4px">
          Projected annual saving vs. staying put
        </div>
        <div style="font-size:24px;font-weight:800;color:#14532D">
          ${fmt$(savingPerYear)}<span style="font-size:13px;font-weight:600;margin-left:4px">/ year</span>
        </div>
        <div style="font-size:11px;color:#14532D;margin-top:4px">
          ≈ ${fmt$(saving25yr)} over 25 years (compounded at 7%/yr).
          This is ON TOP of your solar savings — independent of the system installed.
        </div>
      </div>

      <h3 style="font-size:12px;margin:18px 0 6px;color:#0B0F1A">What to do at install time</h3>
      <ul style="font-size:11px;color:#0B0F1A;margin:0 0 0 20px;line-height:1.6">
        <li>Wait until your system is commissioned + producing — the new plan rewards solar export.</li>
        <li>Cancel your current plan with 14 days' notice (standard NZ retailer term).</li>
        <li>Sign up to <b>${t.switch_to_retailer}</b> — they'll handle the meter swap if needed.</li>
        <li>Send us a copy of the first new bill — we'll confirm the saving matches the projection.</li>
      </ul>

      <p style="font-size:10px;color:#6B7280;margin-top:18px;font-style:italic">
        Projection based on the last 12 months of your billing data run through the recommended
        retailer's published rates. Actual savings depend on your post-install usage profile.
      </p>
    </div>

    ${pageFoot(d, sectionNum, sectionsTotal)}
  </section>`;
}
