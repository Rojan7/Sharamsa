

// --------- Utilities & DOM helpers ----------
const LS_USER = 'cg_user';
const LS_THEME = 'cg_theme';
const LS_LASTCITY = 'cg_lastcity';

// Simple cookie-like safe text
function setSaved(name, val) { try { localStorage.setItem(name,val);} catch(e){} }
function getSaved(name) { try { return localStorage.getItem(name);} catch(e){ return null } }

// Login modals (on pages that include them)
function attachLoginHandlers() {
  const loginBtn = document.getElementById('loginBtn') || document.getElementById('loginBtn2') || document.getElementById('loginBtn3') || document.getElementById('loginBtn4');
  const loginModal = document.getElementById('loginModal') || document.getElementById('loginModal2');
  const doLogin = document.getElementById('doLogin') || document.getElementById('doLogin2');
  const cancelLogin = document.getElementById('cancelLogin') || document.getElementById('cancelLogin2');
  const loginName = document.getElementById('loginName') || document.getElementById('loginName2');

  if (!loginBtn) return;
  loginBtn.addEventListener('click', ()=> { if (loginModal) loginModal.classList.remove('hidden'); });

  if (cancelLogin) cancelLogin.addEventListener('click', ()=> { if (loginModal) loginModal.classList.add('hidden'); });
  if (doLogin && loginName) doLogin.addEventListener('click', ()=>{
    const v = loginName.value && loginName.value.trim();
    if (!v) return alert('Enter a name');
    setSaved(LS_USER, v);
    if (loginModal) loginModal.classList.add('hidden');
    updateGreeting();
  });
}

// theme toggle handlers
function attachTheme() {
  document.querySelectorAll('#themeBtn, #themeBtn2, #themeBtn3, #themeBtn4').forEach(btn=>{
    if (!btn) return;
    btn.addEventListener('click', ()=>{
      const cur = getSaved(LS_THEME) || 'dark';
      const nxt = cur === 'dark' ? 'light' : 'dark';
      applyTheme(nxt);
    });
  });
  const initial = getSaved(LS_THEME) || 'dark';
  applyTheme(initial);
}

function applyTheme(t) {
  if (t === 'dark') {
    document.documentElement.classList.add('dark');
    document.body.classList.remove('bg-white','text-black');
    document.body.classList.add('bg-gray-900','text-gray-100');
    setSaved(LS_THEME, 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('bg-gray-900','text-gray-100');
    document.body.classList.add('bg-white','text-black');
    setSaved(LS_THEME, 'light');
  }
}

// greeting
function updateGreeting() {
  const user = getSaved(LS_USER);
  const greetEls = document.querySelectorAll('#greet');
  greetEls.forEach(el => {
    if (!el) return;
    el.innerText = user ? `Welcome back, ${user}` : 'Welcome — Guest';
  });
}
updateGreeting();

// Attach on load
document.addEventListener('DOMContentLoaded', ()=>{
  attachLoginHandlers();
  attachTheme();
  updateGreeting();
  attachPageSpecific();
});

// ---------- Open-Meteo helpers ----------
async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Geocoding failed');
  const j = await r.json();
  if (!j.results || j.results.length === 0) throw new Error('City not found');
  return j.results[0];
}

async function fetchClimate(lat, lon) {
  // weather with hourly variables
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation,uv_index&timezone=auto`;
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5,pm10&timezone=auto`;

  const [wr, ar] = await Promise.all([fetch(weatherUrl), fetch(aqUrl)]);
  if (!wr.ok) throw new Error('Weather API failed');
  if (!ar.ok) throw new Error('Air quality API failed');

  const wj = await wr.json();
  const aj = await ar.json();
  return { weather: wj, air: aj };
}

// ---------- AQI conversion (PM2.5 -> US AQI) ----------
// Based on EPA breakpoints. Returns object {aqi, category}
function pm25ToAQI(pm) {
  if (pm === null || pm === undefined || isNaN(pm)) return { aqi: null, category: 'Unknown' };
  pm = Number(pm);
  const breakpoints = [
    { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50, cat: 'Good' },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100, cat: 'Moderate' },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, cat: 'Unhealthy for Sensitive' },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200, cat: 'Unhealthy' },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300, cat: 'Very Unhealthy' },
    { cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400, cat: 'Hazardous' },
    { cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500, cat: 'Hazardous' }
  ];
  for (let b of breakpoints) {
    if (pm >= b.cLow && pm <= b.cHigh) {
      const aqi = Math.round(((b.iHigh - b.iLow) / (b.cHigh - b.cLow)) * (pm - b.cLow) + b.iLow);
      return { aqi, category: b.cat };
    }
  }
  return { aqi: null, category: 'Out of range' };
}

// ---------- Chart helpers ----------
function drawLineChart(canvasEl, labels, datasets, options={}) {
  if (!canvasEl) return;
  canvasEl.classList.remove('hidden');
  if (canvasEl._chart) canvasEl._chart.destroy();
  canvasEl._chart = new Chart(canvasEl.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: Object.assign({
      animation:false,
      interaction:{mode:'index', intersect:false},
      plugins:{legend:{position:'top'}}
    }, options)
  });
}

// ---------- Hazard detection ----------
function detectHazards({ temp, precip1h, pm25, uv }) {
  const hazards = [];
  if (temp !== null && temp !== undefined) {
    if (temp >= 35) hazards.push({ type:'Extreme Heat', level:'High', msg:`Temperature ${temp}°C — heatwave risk.` });
    if (temp <= 0) hazards.push({ type:'Extreme Cold', level:'High', msg:`Temperature ${temp}°C — cold wave risk.` });
  }
  if (precip1h !== null && precip1h >= 20) hazards.push({ type:'Heavy Rain', level:'Medium', msg:`Rain ${precip1h} mm last hour — flooding risk.` });
  if (pm25 !== null && pm25 >= 55) hazards.push({ type:'High PM2.5', level:'High', msg:`PM2.5 ${pm25} µg/m³ — poor air quality.` });
  if (uv !== null && uv >= 8) hazards.push({ type:'Very High UV', level:'Medium', msg:`UV ${uv} — sunburn risk.` });
  return hazards;
}

// ---------- Page-specific behaviors ----------
function attachPageSpecific() {
  // index page no special API calls

  // carbon page
  if (document.querySelector('#calcBtnPage')) {
    const calcBtn = document.getElementById('calcBtnPage');
    const saveBtn = document.getElementById('saveRecord');
    const resEl = document.getElementById('calcResultPage');
    const sugEl = document.getElementById('calcSuggestionPage');
    const recList = document.getElementById('recordsList');

    function loadRecords() {
      const raw = getSaved('cg_records');
      const arr = raw ? JSON.parse(raw) : [];
      recList.innerHTML = arr.map(r => `<li>${r.date}: ${r.value} kg CO₂</li>`).join('') || '<li class="text-gray-400">No records</li>';
    }
    loadRecords();

    calcBtn.addEventListener('click', ()=>{
      const travel = Number(document.getElementById('travelInput').value) || 0;
      const elec = Number(document.getElementById('elecInput').value) || 0;
      const waste = Number(document.getElementById('wasteInput').value) || 0;
      const total = (travel * 0.21 + elec * 0.92 + waste * 1.5);
      resEl.innerText = `${total.toFixed(2)} kg CO₂ (est.)`;
      let s = '';
      if (total < 5) s = 'Low footprint — keep it up.';
      else if (total < 15) s = 'Moderate — some reductions possible.';
      else s = 'High — consider strong reductions.';
      sugEl.innerText = s;
    });

    saveBtn.addEventListener('click', ()=>{
      const cur = resEl.innerText || '';
      if (!cur || cur === '—') return alert('Calculate first');
      const value = cur.split(' ')[0];
      const raw = getSaved('cg_records');
      const arr = raw ? JSON.parse(raw) : [];
      arr.unshift({ date: new Date().toLocaleString(), value });
      setSaved('cg_records', JSON.stringify(arr.slice(0,50)));
      loadRecords();
      alert('Saved locally');
    });
  }

  // AQI page
  if (document.getElementById('aqiSearchBtn')) {
    const searchBtn = document.getElementById('aqiSearchBtn');
    const input = document.getElementById('aqiCityInput');
    const pmEl = document.getElementById('aqPm');
    const aqiEl = document.getElementById('aqIndex');
    const catEl = document.getElementById('aqCategory');
    const cityNameEl = document.getElementById('aqCityName');
    const coordsEl = document.getElementById('aqCoords');
    const uvEl = document.getElementById('aqUv');
    const rainEl = document.getElementById('aqRain');
    const chartSkeleton = document.getElementById('chartSkeletonAQ');
    const canvas = document.getElementById('aqChart');
    const tipsEl = document.getElementById('aqTips');

    searchBtn.addEventListener('click', async ()=>{
      const city = input.value.trim();
      if (!city) return alert('Enter a city name');
      chartSkeleton.classList.remove('hidden');
      canvas.classList.add('hidden');
      try {
        const geo = await geocodeCity(city);
        cityNameEl.innerText = `${geo.name}, ${geo.country}`;
        coordsEl.innerText = `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`;
        setSaved(LS_LASTCITY, `${geo.name}, ${geo.country}`);

        const data = await fetchClimate(geo.latitude, geo.longitude);
        const cur = data.weather.current_weather || {};
        const hourly = data.weather.hourly || {};
        const times = hourly.time || [];
        const temps = hourly.temperature_2m || [];
        const uvs = hourly.uv_index || [];
        const precips = hourly.precipitation || [];

        const aqh = (data.air && data.air.hourly) ? data.air.hourly : {};
        const pm2 = aqh.pm2_5 || [];

        // current hour values
        const pmNow = pm2[0] ?? null;
        const uvNow = uvs[0] ?? null;
        const rainNow = precips[0] ?? 0;
        const tempNow = temps[0] ?? (cur.temperature ?? null);

        pmEl.innerText = pmNow !== null ? pmNow : '—';
        const { aqi, category } = pm25ToAQI(pmNow);
        aqiEl.innerText = aqi !== null ? aqi : '—';
        catEl.innerText = category;
        uvEl.innerText = uvNow ?? '—';
        rainEl.innerText = (rainNow ?? '—') + ' mm';

        // tips based on AQI
        let tips = '—';
        if (category === 'Good') tips = 'Air quality is good. Enjoy outdoor activities.';
        else if (category === 'Moderate') tips = 'Sensitive groups should consider reducing prolonged outdoor exertion.';
        else if (category.includes('Unhealthy')) tips = 'Reduce prolonged or heavy outdoor exertion. Consider masks or indoor activities.';
        else tips = 'High pollution — avoid outdoor exercise; use filtration if available.';
        tipsEl.innerText = tips;

        // chart: show last 24 hours (if available)
        const labels = times.slice(0,24).map(t => new Date(t).getHours() + ':00');
        const pm24 = pm2.slice(0,24);
        const datasets = [
          { label:'PM2.5 (µg/m³)', data: pm24, borderWidth:2, tension:0.3 }
        ];
        drawLineChart(canvas, labels, datasets);
      } catch (e) {
        alert('Error: ' + e.message);
      } finally {
        chartSkeleton.classList.add('hidden');
        canvas.classList.remove('hidden');
      }
    });
  }

  // Hazard page
  if (document.getElementById('hazSearchBtn')) {
    const btn = document.getElementById('hazSearchBtn');
    const input = document.getElementById('hazCityInput');
    const output = document.getElementById('hazardOutput');
    const lastEl = document.getElementById('hazLast');
    const adviceEl = document.getElementById('hazAdvice');

    btn.addEventListener('click', async ()=>{
      const city = input.value.trim();
      if (!city) return alert('Enter a city name');
      output.innerHTML = `<div class="p-4 rounded bg-gray-900">Checking... </div>`;
      try {
        const geo = await geocodeCity(city);
        const data = await fetchClimate(geo.latitude, geo.longitude);
        const cur = data.weather.current_weather || {};
        const hourly = data.weather.hourly || {};
        const times = hourly.time || [];
        const temps = hourly.temperature_2m || [];
        const uvs = hourly.uv_index || [];
        const precips = hourly.precipitation || [];
        const aqh = (data.air && data.air.hourly) ? data.air.hourly : {};
        const pm2 = aqh.pm2_5 || [];

        const tempNow = temps[0] ?? (cur.temperature ?? null);
        const rainNow = precips[0] ?? 0;
        const pmNow = pm2[0] ?? null;
        const uvNow = uvs[0] ?? null;

        const hazards = detectHazards({ temp: Number(tempNow), precip1h: Number(rainNow), pm25: Number(pmNow), uv: Number(uvNow) });
        if (!hazards || hazards.length === 0) {
          output.innerHTML = `<div class="p-4 rounded bg-gray-900">No hazards detected for ${geo.name}, ${geo.country}.</div>`;
          adviceEl.innerText = 'No action required.';
        } else {
          output.innerHTML = hazards.map(h => `<div class="p-3 mb-2 rounded ${h.level==='High' ? 'bg-red-800/40' : 'bg-yellow-800/30'}">
              <b>${h.type}</b> — ${h.msg}
            </div>`).join('');
          const advice = hazards.map(h => {
            if (h.type === 'Extreme Heat') return 'Stay hydrated, avoid outdoor exposure during peak heat.';
            if (h.type === 'Extreme Cold') return 'Keep warm, check vulnerable people, avoid long exposure.';
            if (h.type === 'Heavy Rain') return 'Avoid flood-prone areas and follow local warnings.';
            if (h.type === 'High PM2.5') return 'Limit outdoor activity; use masks and indoor air filtration if possible.';
            if (h.type === 'Very High UV') return 'Wear sunscreen and protective clothing; limit midday sun exposure.';
            return '';
          }).join(' ');
          adviceEl.innerText = advice;
        }
        lastEl.innerText = `${geo.name}, ${geo.country} — ${new Date().toLocaleString()}`;
      } catch (e) {
        output.innerHTML = `<div class="p-4 rounded bg-red-900">Error: ${e.message}</div>`;
      }
    });
  }

  // Search shortcuts on index page
  const cta = document.getElementById('ctaDemo');
  if (cta) {
    cta.addEventListener('click', ()=> {
      // if on index, go to aqi demo
      window.location.href = 'aqi.html';
    });
  }
}
