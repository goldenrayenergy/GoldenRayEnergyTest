import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sun, ChevronRight, Bot, RotateCcw } from 'lucide-react';

// ── Knowledge Base ──────────────────────────────────────────────────────────
const KB = {
  cost: {
    title: '💰 System Costs',
    answer: `Solar system costs in NZ typically range:\n\n• **3–4 kW** (small home): $8,500 – $12,000\n• **5–6 kW** (medium home): $12,000 – $16,000\n• **8–10 kW** (large home): $16,000 – $22,000\n• **Battery add-on**: +$8,000 – $15,000\n• **Commercial (25–500 kW)**: Custom quote\n\nAll prices include GST and professional installation. Use our free calculator above for a personalised estimate based on your monthly electricity bill.`,
    followUps: ['How much can I save?', 'What size system do I need?', 'Are there financing options?'],
  },
  how_works: {
    title: '☀️ How Solar Works',
    answer: `Solar power works in 4 stages:\n\n**1. Generation ☀️**\nSolar panels absorb sunlight — photons strike silicon cells and create a DC electrical current.\n\n**2. Conversion ⚡**\nAn inverter transforms DC power into AC power that your home appliances use.\n\n**3. Self-Consumption 🏠**\nYour home uses solar power first, reducing what you draw from the grid.\n\n**4. Export 🔌**\nSurplus power is sent to the grid and your retailer credits you at the buy-back rate.\n\nOn cloudy days and at night, you draw power from the grid as normal.`,
    followUps: ['What is on-grid vs off-grid?', 'Do I need a battery?', 'What are buy-back rates?'],
  },
  battery: {
    title: '🔋 Battery Storage',
    answer: `Two main battery types for solar:\n\n**AC-Coupled Batteries ✅** (Recommended for most)\n• Can be added to an existing solar system later\n• Simpler installation, more flexibility\n• Popular brands: Tesla Powerwall, Enphase, sonnen\n\n**DC-Coupled Batteries**\n• Installed at the same time as solar panels\n• Slightly more efficient but less flexible\n• Requires redesign if adding later\n\n**Do you need a battery?**\nNot essential for on-grid systems. Batteries are worthwhile if:\n• You want backup during power outages\n• You want to maximise evening self-consumption\n• Your retailer has time-of-use pricing\n\n**Cost:** Battery storage adds $8,000–$15,000 to your system cost.`,
    followUps: ['What system types are available?', 'How much does a battery cost?', 'How much can I save with a battery?'],
  },
  size: {
    title: '📏 System Size',
    answer: `Recommended system sizes for NZ homes:\n\n• **$100–$150/month bill → 3 kW** (~6 panels)\n• **$150–$250/month bill → 5 kW** (~9 panels)\n• **$250–$350/month bill → 6.6 kW** (~12 panels)\n• **$350–$500/month bill → 8–10 kW** (~15–18 panels)\n• **$500+/month bill → 10–15 kW** (18–27 panels)\n\n**Key factors that affect sizing:**\n• Your monthly electricity bill amount\n• Number of people in the household\n• Roof orientation (north-facing is best in NZ)\n• Whether you want a battery\n• Any planned EV charging or heat pumps\n\nUse our free calculator above for a precise recommendation.`,
    followUps: ['Is my roof suitable for solar?', 'How much does it cost?', 'How many panels do I need?'],
  },
  savings: {
    title: '💡 Savings & ROI',
    answer: `Expected savings with solar in NZ:\n\n• **Bill reduction: 70–90%** for most households\n• Average $300/month bill → saves ~$250/month\n• Annual savings: $2,400 – $4,000 for a typical home\n• 25-year lifetime savings: $60,000 – $100,000+\n\n**Tips to maximise savings:**\n1. **Self-consumption** — Use appliances during daylight (dishwasher, laundry, EV charging)\n2. **Battery storage** — Store excess solar for evening use\n3. **Monitor your system** — Track production and usage via the inverter app\n\n**Grid electricity costs ~30c/kWh** in NZ vs solar which effectively costs near zero once installed. Electricity prices also increase ~3% per year — solar locks in your cost.`,
    followUps: ['What is the payback period?', 'What are NZ buy-back rates?', 'Do I need a battery?'],
  },
  payback: {
    title: '⏱️ Payback Period',
    answer: `Solar payback period in NZ:\n\n• **Typical payback: 5–8 years** for residential\n• Commercial systems often pay back in 3–5 years\n• Solar panels have a **25–30 year lifespan**\n• After payback → essentially free energy for 17–22 more years\n\n**Example calculation:**\n• 6.6 kW system cost: $14,000\n• Annual savings: $2,400\n• Payback: ~5.8 years\n• 25-year net benefit: ~$46,000\n\n**What speeds up your payback:**\n• High electricity usage\n• North-facing roof with minimal shading\n• Maximising self-consumption\n• Rising grid electricity prices (avg 3%/year in NZ)\n• Adding battery storage to reduce grid imports`,
    followUps: ['How much can I save?', 'How much does it cost?', 'Are there financing options?'],
  },
  environment: {
    title: '🌿 Environmental Benefits',
    answer: `Environmental benefits of going solar:\n\n🌿 **Zero emissions** — Solar produces no greenhouse gases or pollutants during operation.\n\n🏭 **CO₂ reduction** — A typical 6.6 kW system saves 2–3 tonnes of CO₂ per year.\n\n🌳 **Tree equivalent** — That's like planting 40–60 trees every single year.\n\n⚡ **NZ grid context** — While NZ has ~80% renewable electricity, 10–20% still comes from fossil fuels. Solar eliminates your reliance on that portion entirely.\n\n🌍 **Lifetime impact** — Over 25 years, one household solar system offsets 50–75 tonnes of CO₂.\n\nSolar also reduces strain on the grid during peak demand hours, benefiting the entire community.`,
    followUps: ['How does solar work?', 'What size system do I need?', 'Get a free quote'],
  },
  roof: {
    title: '🏠 Roof Suitability',
    answer: `Is your roof suitable for solar?\n\n✅ **Ideal conditions:**\n• North-facing roof (maximises sunlight in NZ)\n• Pitch of 15–35 degrees\n• Minimal shading from trees or buildings\n• Enough space (each panel ~1.7m × 1m)\n\n⚠️ **Still workable:**\n• East or west-facing roofs (10–20% less output)\n• Flat roofs (panels angled with mounting brackets)\n• Partial shading (microinverters or optimisers can help)\n\n❌ **May be problematic:**\n• South-facing only with no other options\n• Heavy all-day shading\n• Roof in poor structural condition\n\n**Roof types we install on:**\nCorrugated iron/Coloursteel, concrete tiles, clay tiles, metal tiles, and flat membrane roofs.\n\nWe do a free site assessment to confirm suitability before quoting.`,
    followUps: ['What is the installation process?', 'What size system do I need?', 'Get a free quote'],
  },
  installation: {
    title: '📋 Installation Process',
    answer: `Solar installation process — step by step:\n\n**Step 1: Free Quote 📋**\nFill our online form or call us. We assess your bill, usage, and roof.\n\n**Step 2: Site Survey 🔍**\nOur engineer visits to check roof structure, orientation, shading, and switchboard.\n\n**Step 3: Custom Design 📐**\nWe design the optimal panel layout and system size for your property.\n\n**Step 4: Council & Grid Approval 📜**\nWe handle all consent paperwork and grid connection applications.\n\n**Step 5: Installation Day 🔧**\nCertified electricians install panels, inverter, and wiring. Usually 1–2 days residential.\n\n**Step 6: Inspection & Sign-off ✅**\nElectrical inspection and grid connection confirmed.\n\n**Step 7: Power On! ⚡**\nSystem goes live. We show you how to monitor production and savings.\n\n**Total timeline: typically 4–8 weeks** from first quote to power-on.`,
    followUps: ['Do I need council consent?', 'Is my roof suitable?', 'How much does it cost?'],
  },
  grid_types: {
    title: '🔌 On-Grid vs Off-Grid',
    answer: `The three solar system types explained:\n\n**🔌 On-Grid (Grid-Tied)**\n• Connected to the electricity grid\n• Grid acts as backup when solar isn't producing\n• Exports excess power for buy-back credits\n• Most popular & most cost-effective option\n• No battery required\n\n**🔋 Hybrid (Grid + Battery)**\n• Connected to grid AND has battery storage\n• Battery stores excess solar for evening use\n• Grid backup available if battery runs out\n• Best for maximising self-consumption\n• Higher upfront cost, better long-term savings\n\n**🏡 Off-Grid (Fully Independent)**\n• Completely independent from the grid\n• Requires large battery bank to cover all needs\n• Best for remote properties where grid connection is expensive\n• Higher setup cost, zero power bills forever\n• Must be carefully sized to cover seasonal variation`,
    followUps: ['Do I need a battery?', 'What are buy-back rates?', 'What size system do I need?'],
  },
  buyback: {
    title: '💸 Buy-Back Rates NZ',
    answer: `Solar buy-back rates in New Zealand:\n\nWhen your panels produce more than you use, surplus is exported to the grid and your retailer credits you.\n\n**Current NZ buy-back rates: 8–16 cents/kWh**\n(Grid power costs ~28–32 cents/kWh to buy)\n\n**Key insight:** You earn less for power you export than you save by using it yourself. That's why **self-consumption is always the priority** — use solar directly rather than exporting.\n\n**Top NZ retailers for solar buy-back:**\n• Mercury Energy\n• Contact Energy\n• Meridian Energy\n• Genesis Energy\n• Flick Electric (variable rates)\n\n**Tip:** Look for retailers with "time-of-use" plans. Combined with a battery, you can charge overnight at cheap rates and avoid peak pricing.`,
    followUps: ['How can I maximise my savings?', 'Do I need a battery?', 'How does solar work?'],
  },
  warranty: {
    title: '🛡️ Warranties',
    answer: `Solar warranties in NZ — what to expect:\n\n**Solar Panels:**\n• 25-year performance warranty (guaranteed output level)\n• 10–12 year product warranty (manufacturing defects)\n• Panels typically produce 80–85% of rated output after 25 years\n\n**Inverters:**\n• 5–10 year standard warranty\n• Extended warranties available (up to 15 years)\n• Replacement cost: $1,500–$3,000\n\n**Installation (Workmanship):**\n• GoldenRay provides a 10-year workmanship guarantee\n• Covers mounting, wiring, and installation quality\n\n**Battery Storage:**\n• 10-year warranty on most modern batteries (e.g. Tesla Powerwall)\n• Guaranteed capacity retention (e.g. 70% after 10 years)\n\n✅ All GoldenRay installations include a free system health check in year one.`,
    followUps: ['What maintenance is required?', 'What is the installation process?', 'How much does it cost?'],
  },
  maintenance: {
    title: '🔧 Maintenance',
    answer: `Solar maintenance — minimal effort required:\n\n**Panels:**\n• NZ rainfall naturally cleans most panels\n• Annual clean recommended (hosing down or professional)\n• Avoid abrasive cleaners — just water\n• Check for debris, bird droppings, or new shading from trees\n\n**Inverter:**\n• Check warning lights periodically\n• Typically lasts 10–15 years before replacement\n• Keep area well-ventilated\n\n**Monitoring:**\n• Most modern inverters have an app to monitor daily output\n• Check production matches expected levels seasonally\n• Alert us if output drops significantly\n\n**Annual check (recommended):**\n• Inspect mounting brackets and cabling\n• Clean panels professionally\n• Review inverter performance data\n\n**Cost:** ~$150–$300/year for a professional annual service. Most systems need very little attention beyond this.`,
    followUps: ['What warranties are included?', 'How does solar work?', 'Get a free quote'],
  },
  consent: {
    title: '📜 Council Consent',
    answer: `Council consent for solar in NZ:\n\n✅ **Most residential solar does NOT need building consent** when:\n• Panels don't project more than 500mm beyond the roof surface\n• Total weight doesn't exceed structural limits\n• Installed on a standard residential or rural property\n\n**What IS required (we handle all of this for you):**\n• **Electrical Certificate of Compliance (CoC)** — issued by our licensed electrician\n• **Grid connection application** — submitted to your lines company\n• **Building consent** — only for flat-roof mounted structures or heritage buildings\n\n**Commercial installations** may have additional requirements depending on the system size and building type.\n\nGoldenRay manages all paperwork, council applications, electrical certificates, and grid connection so you don't have to lift a finger.`,
    followUps: ['What is the installation process?', 'Is my roof suitable?', 'Get a free quote'],
  },
  financing: {
    title: '💳 Solar Finance — $0 Upfront Options',
    answer: `Goldenray partners with major NZ lenders so you can go solar with **zero upfront cost**. Pick the option that fits you:\n\n**1. Bank Green Loan 🌿 — 1% p.a. for 5 yrs**\nWestpac, ANZ & Kiwibank offer ultra-low "green" top-ups up to $80K. Cheapest option for mortgage holders. Often your bill savings cover the repayment from day one.\n\n**2. Interest-Free 📆 — 0% for 36 months**\nPay zero interest for 3 years on systems up to $30K. From ~$99/month on a typical 6.6kW system. Great if you want to spread payments quickly.\n\n**3. Payment Plan 💳 — from $45/week**\nFixed weekly or fortnightly installments over 3–10 years. No home ownership required, unsecured. Fast online credit check.\n\n**4. Home Loan Top-Up 🏦 — lowest rate**\nAdd solar to your mortgage at your current home-loan rate. Longest term, lowest monthly cost, one single repayment.\n\n**What happens next?**\n• Fill out the no-obligation enquiry in our Finance section (scroll to the 🟢 "Go Solar with Zero Upfront Cost" block)\n• We send it to the best-fit lender — soft credit check only\n• Pre-approval in 24 hours. Hard credit check only runs if you accept an offer.`,
    followUps: ['How much does it cost?', 'What is the payback period?', 'Get a free quote'],
  },
  panels: {
    title: '🔆 Choosing Solar Panels',
    answer: `How to choose solar panels for your NZ home:\n\n**Key specifications to compare:**\n• **Wattage:** Modern panels are 370–600W. Higher wattage = fewer panels needed.\n• **Efficiency:** 19–23% is the range for quality panels. Higher efficiency = better output in limited roof space.\n• **Temperature coefficient:** NZ summers can get hot. Look for -0.3%/°C or better.\n• **Warranty:** 25-year performance, 10–12 year product warranty minimum.\n\n**Top panel brands available in NZ:**\n• SunPower / Maxeon (premium, highest efficiency)\n• LG NeON (premium)\n• REC Group (excellent quality/value)\n• Jinko Solar (popular, good value)\n• Canadian Solar (reliable, affordable)\n\n**Monocrystalline vs Polycrystalline:**\nMonocrystalline panels are more efficient and perform better in low-light — recommended for NZ conditions.`,
    followUps: ['How many panels do I need?', 'What about inverters?', 'How much does it cost?'],
  },
  inverter: {
    title: '⚡ Choosing an Inverter',
    answer: `Inverter types for solar systems:\n\n**String Inverter (most common)**\n• One central inverter for all panels\n• Most affordable option\n• If one panel is shaded, affects whole string slightly\n• Best for: unshaded, same-direction roofs\n\n**Microinverters**\n• One small inverter per panel\n• Each panel operates independently — shading on one doesn't affect others\n• Better monitoring per panel\n• Higher cost but ideal for complex or shaded roofs\n\n**Hybrid Inverter**\n• Manages both solar panels AND battery storage\n• All-in-one solution for hybrid systems\n• Future-ready if you want to add battery later\n\n**Top brands in NZ:**\n• Fronius (Austrian, premium quality)\n• SolarEdge (with optimisers)\n• Enphase (microinverters)\n• Sungrow (popular, reliable)\n• Huawei SUN2000 (smart monitoring)`,
    followUps: ['Do I need a battery?', 'What panels should I choose?', 'How much does it cost?'],
  },
  offgrid: {
    title: '🏡 Off-Grid Solar',
    answer: `Off-grid solar — full energy independence:\n\n**What is off-grid solar?**\nA system completely disconnected from the electricity grid. All your power comes from solar panels and battery storage.\n\n**Is off-grid right for you?**\n✅ Best for:\n• Remote or rural properties far from the grid\n• High grid connection costs (lines company charges)\n• Those wanting total energy independence\n• Bach or holiday home with no grid supply\n\n⚠️ Considerations:\n• Higher upfront cost (large battery bank needed)\n• Must be carefully sized for winter low-sun months\n• Backup generator often recommended for extended cloudy periods\n• No grid safety net — system must cover 100% of your needs\n\n**Typical off-grid system:** 10–15 kW solar + 20–40 kWh battery bank\n**Cost:** $35,000 – $80,000+ depending on energy needs`,
    followUps: ['What system types are there?', 'Do I need a battery?', 'Get a free quote'],
  },
  commercial: {
    title: '🏢 Commercial Solar',
    answer: `Commercial solar in NZ — key facts:\n\n**System sizes:**\n• Small commercial: 25–50 kW (shops, small offices)\n• Medium commercial: 50–200 kW (warehouses, factories)\n• Large commercial: 200 kW–1 MW+ (industrial sites)\n\n**Financial benefits for businesses:**\n• Electricity is a major operating cost — solar reduces it by 60–90%\n• Faster payback than residential (3–5 years typical)\n• Depreciation benefits for business assets\n• Improved ESG credentials and sustainability reporting\n\n**Commercial-specific considerations:**\n• Three-phase power connections\n• Load profile analysis to right-size the system\n• Roof structural assessment (flat commercial roofs common)\n• Network connection approval from lines company\n• Potential for battery demand-charge reduction\n\n**GoldenRay commercial projects:**\nWe've installed systems from 25 kW to 320 kW across NZ. Contact us for a free commercial energy assessment.`,
    followUps: ['What is the installation process?', 'What are buy-back rates?', 'Get a free quote'],
  },
  selfconsumption: {
    title: '🔄 Self-Consumption',
    answer: `Maximising solar self-consumption in NZ:\n\n**Why self-consumption matters:**\nYou get ~30c/kWh of value when you use solar directly vs only ~8–16c/kWh when you export to the grid. Self-consumption is up to 3× more valuable than exporting.\n\n**Practical strategies:**\n• **Run appliances during daylight hours** — dishwasher, washing machine, dryer, oven\n• **Schedule EV charging** to solar production hours (9am–3pm)\n• **Heat pump water heaters** can be timed to solar peak hours\n• **Pool pumps** — run during daylight instead of overnight\n• **Battery storage** — capture excess midday solar for evening use\n\n**Self-consumption rates:**\n• Without battery: typically 30–50% of solar production used directly\n• With battery: can increase to 70–90%\n\n**Monitoring helps** — most inverter apps show your self-consumption ratio in real time.`,
    followUps: ['Do I need a battery?', 'What are buy-back rates?', 'How much can I save?'],
  },
};

// ── Quick Topic Buttons ──────────────────────────────────────────────────────
const QUICK_TOPICS = [
  { label: '💰 System costs',        key: 'cost' },
  { label: '☀️ How solar works',      key: 'how_works' },
  { label: '🔋 Battery storage',      key: 'battery' },
  { label: '📏 What size do I need?', key: 'size' },
  { label: '💡 Savings & ROI',        key: 'savings' },
  { label: '⏱️ Payback period',       key: 'payback' },
  { label: '🌿 Environment',          key: 'environment' },
  { label: '🏠 Roof suitability',     key: 'roof' },
  { label: '📋 Installation steps',   key: 'installation' },
  { label: '🔌 On-Grid vs Off-Grid',  key: 'grid_types' },
  { label: '💸 Buy-back rates NZ',    key: 'buyback' },
  { label: '🛡️ Warranties',           key: 'warranty' },
  { label: '🔧 Maintenance',          key: 'maintenance' },
  { label: '📜 Council consent',      key: 'consent' },
  { label: '💳 Financing options',    key: 'financing' },
  { label: '🔆 Choosing panels',      key: 'panels' },
  { label: '⚡ Choosing inverter',     key: 'inverter' },
  { label: '🏡 Off-Grid solar',       key: 'offgrid' },
  { label: '🏢 Commercial solar',     key: 'commercial' },
  { label: '🔄 Self-consumption',     key: 'selfconsumption' },
];

// ── Keyword → topic mapping ──────────────────────────────────────────────────
const KEYWORD_MAP = [
  { keys: ['cost','price','expensive','cheap','afford','how much','dollar','$','nzd','pricing'], topic: 'cost' },
  { keys: ['how','work','works','generate','generation','photon','silicon','dc','ac','convert','conversion'], topic: 'how_works' },
  { keys: ['battery','storage','powerwall','backup','overnight','night','evening','tesla','sonnen','enphase','ac coupled','dc coupled'], topic: 'battery' },
  { keys: ['size','kw','kilowatt','how big','big','small','panels how many','number of panel','system size'], topic: 'size' },
  { keys: ['save','saving','bill','reduce','cheaper','discount','benefit','return','roi','profit'], topic: 'savings' },
  { keys: ['payback','pay back','recoup','years','when','roi','investment','break even'], topic: 'payback' },
  { keys: ['environment','carbon','co2','emission','green','eco','tree','planet','climate','greenhouse'], topic: 'environment' },
  { keys: ['roof','suitable','facing','north','tilt','shade','shading','structure','pitch','angle'], topic: 'roof' },
  { keys: ['install','installation','process','step','how long','timeline','days','weeks','time'], topic: 'installation' },
  { keys: ['on-grid','off-grid','on grid','off grid','hybrid','system type','grid','type of system'], topic: 'grid_types' },
  { keys: ['buy back','buyback','export','sell','credit','rate','retailer','mercury','contact energy','meridian'], topic: 'buyback' },
  { keys: ['warrant','guarantee','lifespan','life','years panel','product warranty'], topic: 'warranty' },
  { keys: ['maintain','maintenance','clean','service','repair','look after','care'], topic: 'maintenance' },
  { keys: ['council','consent','permit','building','approval','compliance','law','regulation'], topic: 'consent' },
  { keys: ['finance','financing','loan','borrow','mortgage','interest','pay off','afford','payment plan'], topic: 'financing' },
  { keys: ['panel','monocrystalline','polycrystalline','wattage','efficiency','jinko','rec','canadian solar','sunpower'], topic: 'panels' },
  { keys: ['inverter','fronius','sungrow','huawei','microinverter','string inverter','hybrid inverter'], topic: 'inverter' },
  { keys: ['off grid','offgrid','remote','independent','isolation','bach','cabin','rural'], topic: 'offgrid' },
  { keys: ['commercial','business','warehouse','factory','office','company','industrial','3 phase'], topic: 'commercial' },
  { keys: ['self consumption','selfconsumption','use','appliance','dishwasher','ev','electric vehicle','pool','maximise'], topic: 'selfconsumption' },
];

function findTopic(text) {
  const lower = text.toLowerCase();
  for (const { keys, topic } of KEYWORD_MAP) {
    if (keys.some(k => lower.includes(k))) return topic;
  }
  return null;
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function BotMessage({ text }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        // Bold: **text**
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <p key={i} className={line.startsWith('•') ? 'pl-2' : ''}>
            {parts.map((part, j) =>
              j % 2 === 1 ? <strong key={j} className="font-semibold text-gray-900">{part}</strong> : part
            )}
          </p>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SolarChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [showTopics, setShowTopics] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const GREETING = {
    id: 'greeting',
    from: 'bot',
    text: `Kia ora — I'm **SolarBot**, GoldenRay Energy's New Zealand solar assistant.\n\nAsk me about system costs, savings, installation, batteries, warranties, or anything else solar-related. Every answer is calibrated to NZ conditions and pricing.\n\nPick a topic below, or type your question:`,
  };

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([GREETING]);
      setShowTopics(true);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const addBotReply = (topic) => {
    const entry = KB[topic];
    if (!entry) {
      setMessages(m => [...m, {
        id: Date.now(),
        from: 'bot',
        text: `I don't have a specific answer for that one. For tailored advice, call **+64 21 839 356** or use the **Free Quote Calculator** above — it'll give you a personalised estimate in under a minute.`,
        followUps: ['How much does it cost?', 'How does solar work?', 'Get a free quote'],
      }]);
      return;
    }
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages(m => [...m, {
        id: Date.now(),
        from: 'bot',
        text: entry.answer,
        followUps: entry.followUps,
      }]);
      setShowTopics(false);
    }, 700 + Math.random() * 400);
  };

  const handleTopicClick = (key) => {
    const entry = KB[key];
    setMessages(m => [...m, { id: Date.now() + 'u', from: 'user', text: entry?.title || key }]);
    setShowTopics(false);
    addBotReply(key);
  };

  const handleFollowUp = (text) => {
    if (text === 'Get a free quote') {
      setMessages(m => [...m,
        { id: Date.now() + 'u', from: 'user', text },
        { id: Date.now() + 'b', from: 'bot', text: `Scroll up to the **Free Solar Calculator** — enter your monthly power bill and you'll get a personalised quote within seconds, including system size, projected savings, and payback period.\n\nPrefer to talk it through? Call **+64 21 839 356**.`, followUps: [] },
      ]);
      return;
    }
    setMessages(m => [...m, { id: Date.now() + 'u', from: 'user', text }]);
    const topic = findTopic(text);
    if (topic) addBotReply(topic);
    else {
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        setMessages(m => [...m, {
          id: Date.now(),
          from: 'bot',
          text: `That's outside what I can answer accurately on my own. For the most reliable response, our solar specialists are best placed to help.\n\n📞 Call: **+64 21 839 356**\n📧 Email: **hello@goldenrayenergy.co.nz**\n\nYou can also use the **Free Calculator** at the top of the page for an instant personalised quote.`,
          followUps: ['How much does it cost?', 'What size do I need?', 'Get a free quote'],
        }]);
      }, 800);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setShowTopics(false);
    setMessages(m => [...m, { id: Date.now() + 'u', from: 'user', text }]);
    const topic = findTopic(text);
    if (topic) {
      addBotReply(topic);
    } else {
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        setMessages(m => [...m, {
          id: Date.now(),
          from: 'bot',
          text: `I don't have a specific answer for that one. Try a topic below, or contact our team directly:\n\n📞 **+64 21 839 356**\n📧 **hello@goldenrayenergy.co.nz**`,
          followUps: ['How much does it cost?', 'How does solar work?', 'What size do I need?'],
        }]);
        setShowTopics(true);
      }, 800);
    }
  };

  const handleReset = () => {
    setMessages([GREETING]);
    setShowTopics(true);
    setInput('');
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95"
        style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)' }}
        aria-label="Open solar chatbot"
      >
        {open
          ? <X size={22} className="text-white" />
          : <MessageCircle size={24} className="text-white" />
        }
        {!open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
        )}
      </button>

      {/* Chat Window */}
      <div className={`fixed bottom-24 right-3 left-3 sm:left-auto sm:right-6 z-50 sm:w-[370px] max-h-[80vh] sm:max-h-[600px] flex flex-col rounded-2xl shadow-2xl border border-gray-100 bg-white overflow-hidden transition-all duration-300 origin-bottom-right
        ${open ? 'scale-100 opacity-100 pointer-events-auto' : 'scale-90 opacity-0 pointer-events-none'}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)' }}>
          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center flex-shrink-0 overflow-hidden p-0.5">
            <img src="/logo.jpg" alt="Goldenray Energy NZ" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-none">SolarBot</p>
            <p className="text-white/80 text-[10px] mt-0.5">Goldenray Energy NZ • Always online</p>
          </div>
          <button onClick={handleReset} title="Restart chat"
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">
            <RotateCcw size={13} className="text-white" />
          </button>
          <button onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">
            <X size={14} className="text-white" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/60" style={{ maxHeight: 420 }}>
          {messages.map((msg) => (
            <div key={msg.id}>
              <div className={`flex items-end gap-2 ${msg.from === 'user' ? 'flex-row-reverse' : ''}`}>
                {msg.from === 'bot' && (
                  <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mb-0.5"
                    style={{ background: 'linear-gradient(135deg,#f59e0b,#ea580c)' }}>
                    <Sun size={13} className="text-white" />
                  </div>
                )}
                <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm
                  ${msg.from === 'user'
                    ? 'bg-amber-500 text-white rounded-br-sm font-medium'
                    : 'bg-white border border-gray-100 text-gray-700 rounded-bl-sm shadow-sm'}`}
                >
                  {msg.from === 'bot' ? <BotMessage text={msg.text} /> : msg.text}
                </div>
              </div>

              {/* Follow-up suggestions */}
              {msg.from === 'bot' && msg.followUps?.length > 0 && (
                <div className="mt-2 ml-9 flex flex-wrap gap-1.5">
                  {msg.followUps.map(f => (
                    <button key={f} onClick={() => handleFollowUp(f)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-semibold hover:bg-amber-100 transition-all">
                      <ChevronRight size={10} />
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {typing && (
            <div className="flex items-end gap-2">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,#f59e0b,#ea580c)' }}>
                <Sun size={13} className="text-white" />
              </div>
              <div className="px-4 py-3 bg-white border border-gray-100 rounded-2xl rounded-bl-sm shadow-sm">
                <div className="flex gap-1 items-center">
                  {[0, 1, 2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick Topics grid */}
          {showTopics && !typing && (
            <div className="mt-2">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2 px-1">Popular topics</p>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_TOPICS.map(t => (
                  <button key={t.key} onClick={() => handleTopicClick(t.key)}
                    className="text-left px-2.5 py-2 rounded-xl bg-white border border-gray-100 hover:border-amber-300 hover:bg-amber-50 text-[11px] font-semibold text-gray-600 hover:text-amber-700 transition-all leading-tight shadow-sm">
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-gray-100 bg-white">
          <div className="flex gap-2 items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask me anything about solar…"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition bg-gray-50"
            />
            <button onClick={handleSend} disabled={!input.trim()}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 hover:scale-105 active:scale-95"
              style={{ background: 'linear-gradient(135deg,#f59e0b,#ea580c)' }}>
              <Send size={15} className="text-white" />
            </button>
          </div>
          <p className="text-[9px] text-gray-400 text-center mt-1.5">Powered by Goldenray Energy NZ · Powering a Sustainable Future</p>
        </div>
      </div>
    </>
  );
}
