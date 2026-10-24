(() => {
  const STORAGE_KEY = 'stevenPay_v2_data';

  // FECHA ANCLA EXACTA: Viernes 30 de Octubre
  const ANCHOR_DATE = new Date(2026, 9, 30); // Mes 9 = Octubre (0-indexed)

  const moneyFormat = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  const getTodayString = () => new Date().toISOString().split('T')[0];
  const sanitize = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Lista inmutable de Pagos Fijos
  const DEFAULT_PAYMENTS = [
    { id: 'salvador', name: 'Salvador Morales', category: 'Transferencia Davivienda', amount: 37.50 },
    { id: 'andrea', name: 'Andrea Rivera', category: 'Transferencia Davivienda', amount: 37.50 },
    { id: 'mayra', name: 'Mayra Morales', category: 'Transferencia Davivienda', amount: 41.00 }
  ];

  let state = {
    cycleOffset: 0,
    paymentStates: {},
    transactions: []
  };

  let activeFilter = 'todos';
  let searchQuery = '';

  // Generador inteligente de ciclos de 14 días
  function getCycleDetails(offset = 0) {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - ANCHOR_DATE.getTime()) / (1000 * 3600 * 24));
    let cycleIndex = Math.floor(diffDays / 14) + offset;

    const startDate = new Date(ANCHOR_DATE);
    startDate.setDate(ANCHOR_DATE.getDate() + (cycleIndex * 14));

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 13);

    const fmt = d => `${d.getDate()} ${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]}`;
    const cycleId = `${startDate.getFullYear()}-${startDate.getMonth() + 1}-${startDate.getDate()}`;

    return {
      cycleId,
      label: offset === 0 ? 'CATORCENA ACTUAL' : (offset < 0 ? 'CATORCENA PASADA' : 'CATORCENA FUTURA'),
      rangeText: `${fmt(startDate)} - ${fmt(endDate)} ${endDate.getFullYear()}`
    };
  }

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.transactions)) {
        state.transactions = saved.transactions;
        state.paymentStates = saved.paymentStates || {};
      }
    } catch (e) {}
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderApp();
  }

  function renderPayments(cycleId) {
    const container = document.getElementById('paymentsList');
    const cycleStatus = state.paymentStates[cycleId] || {};

    container.innerHTML = DEFAULT_PAYMENTS.map(p => {
      const status = cycleStatus[p.id] || 'pendiente';
      const isPaid = status === 'pagado';
      const badgeClass = isPaid ? 'sub-badge' : (status === 'programado' ? 'pill-info' : '');
      const statusLabel = isPaid ? '✓ Liquidado' : (status === 'programado' ? 'Programado' : 'Pendiente');

      return `
        <div class="pay-item ${isPaid ? 'is-paid' : ''}">
          <div class="pay-item-top">
            <div>
              <div class="pay-name">${sanitize(p.name)}</div>
              <small style="color:var(--text-muted);">${sanitize(p.category)}</small>
            </div>
            <div>
              <span class="money" style="font-weight:800; display:block; text-align:right;">${moneyFormat(p.amount)}</span>
              <span class="${badgeClass}" style="font-size:0.68rem;">${statusLabel}</span>
            </div>
          </div>
          <select data-pay-id="${p.id}" style="font-size:0.8rem; min-height:36px; margin-top:4px;">
            <option value="pendiente" ${status === 'pendiente' ? 'selected' : ''}>Marcar Pendiente</option>
            <option value="programado" ${status === 'programado' ? 'selected' : ''}>Programado en Davivienda</option>
            <option value="pagado" ${status === 'pagado' ? 'selected' : ''}>Pagado / Verificado</option>
          </select>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-pay-id]').forEach(select => {
      select.addEventListener('change', e => {
        const pId = select.dataset.payId;
        if (!state.paymentStates[cycleId]) state.paymentStates[cycleId] = {};
        state.paymentStates[cycleId][pId] = e.target.value;

        const p = DEFAULT_PAYMENTS.find(x => x.id === pId);
        state.transactions.push({
          id: String(Date.now()),
          type: 'estado',
          date: getTodayString(),
          name: p.name,
          amount: p.amount,
          cycleId,
          status: e.target.value
        });
        saveData();
      });
    });
  }

  function renderHistory() {
    let list = [...state.transactions];

    if (activeFilter !== 'todos') list = list.filter(t => t.type === activeFilter);
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      list = list.filter(t => (t.name && t.name.toLowerCase().includes(q)) || (t.note && t.note.toLowerCase().includes(q)));
    }

    list.sort((a, b) => b.id - a.id);

    const container = document.getElementById('historyList');
    container.innerHTML = list.map(t => {
      const isInc = t.type === 'ingreso';
      const colorClass = isInc ? 'positive' : (t.type === 'gasto' ? 'negative' : '');
      const sign = isInc ? '+' : (t.type === 'gasto' ? '-' : '');

      return `
        <div class="history-card">
          <div>
            <div style="font-weight:700; font-size:0.88rem;">${sanitize(t.name || 'Ingreso')}</div>
            <small style="color:var(--text-muted); font-size:0.75rem;">${sanitize(t.date)} ${t.note ? '· ' + sanitize(t.note) : ''}</small>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="money ${colorClass}" style="font-weight:800;">${sign}${moneyFormat(t.amount)}</span>
            <button class="btn btn-secondary delete-btn" data-del="${t.id}" style="min-height:28px; width:28px; padding:0; border-radius:8px;">✕</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('¿Eliminar registro?')) return;
        state.transactions = state.transactions.filter(t => t.id !== btn.dataset.del);
        saveData();
      });
    });

    document.getElementById('historyCount').textContent = `${list.length} registros`;
    document.getElementById('historyEmpty').style.display = list.length ? 'none' : 'block';
  }

  function renderApp() {
    const cycle = getCycleDetails(state.cycleOffset);

    document.getElementById('cycleLabel').textContent = cycle.label;
    document.getElementById('cycleDates').textContent = cycle.rangeText;

    const cycleTx = state.transactions.filter(t => t.cycleId === cycle.cycleId);
    const income = cycleTx.filter(t => t.type === 'ingreso').reduce((s, t) => s + Number(t.amount), 0);
    const extras = cycleTx.filter(t => t.type === 'gasto').reduce((s, t) => s + Number(t.amount), 0);

    const cycleStatus = state.paymentStates[cycle.cycleId] || {};
    const paid = DEFAULT_PAYMENTS.filter(p => cycleStatus[p.id] === 'pagado').reduce((s, p) => s + Number(p.amount), 0);
    const reserved = DEFAULT_PAYMENTS.filter(p => cycleStatus[p.id] !== 'pagado').reduce((s, p) => s + Number(p.amount), 0);
    const totalPlanned = DEFAULT_PAYMENTS.reduce((s, p) => s + Number(p.amount), 0);

    const balance = income - paid - extras - reserved;

    document.getElementById('balance').textContent = moneyFormat(balance);
    document.getElementById('incomeTotal').textContent = moneyFormat(income);
    document.getElementById('plannedTotal').textContent = moneyFormat(totalPlanned);
    document.getElementById('extraTotal').textContent = moneyFormat(extras);
    document.getElementById('reservedTotal').textContent = moneyFormat(reserved);

    const spent = paid + extras + reserved;
    let pct = income > 0 ? Math.min(100, Math.round((spent / income) * 100)) : 0;
    const bar = document.getElementById('healthBar');
    bar.style.width = `${pct}%`;
    bar.style.backgroundColor = pct > 90 ? 'var(--red)' : (pct > 70 ? 'var(--orange)' : 'var(--green)');

    renderPayments(cycle.cycleId);
    renderHistory();
  }

  // Eventos e Inicialización
  document.getElementById('incomeDate').value = getTodayString();
  document.getElementById('expenseDate').value = getTodayString();

  document.getElementById('prevCycleBtn').addEventListener('click', () => { state.cycleOffset--; saveData(); });
  document.getElementById('nextCycleBtn').addEventListener('click', () => { state.cycleOffset++; saveData(); });

  // SPA Navigation
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.bottom-nav .nav-item').forEach(b => b.classList.remove('active'));

      document.getElementById(btn.dataset.target).classList.add('active');
      btn.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Formularios
  document.getElementById('incomeForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = Number(document.getElementById('incomeAmount').value);
    if (!(amount > 0)) return;

    const cycle = getCycleDetails(state.cycleOffset);
    state.transactions.push({
      id: String(Date.now()),
      type: 'ingreso',
      date: document.getElementById('incomeDate').value,
      amount,
      cycleId: cycle.cycleId,
      note: document.getElementById('incomeNote').value.trim()
    });

    document.getElementById('incomeAmount').value = '';
    document.getElementById('incomeNote').value = '';
    saveData();
  });

  document.getElementById('expenseForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = Number(document.getElementById('expenseAmount').value);
    const name = document.getElementById('expenseName').value.trim();
    const cat = document.getElementById('expenseCategory').value;
    if (!(amount > 0) || !name) return;

    const cycle = getCycleDetails(state.cycleOffset);
    state.transactions.push({
      id: String(Date.now()),
      type: 'gasto',
      date: document.getElementById('expenseDate').value,
      name: `${cat} · ${name}`,
      amount,
      cycleId: cycle.cycleId
    });

    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseName').value = '';
    saveData();
  });

  // Filtros
  document.querySelectorAll('#filterTabs .filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filterTabs .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderHistory();
    });
  });

  document.getElementById('historySearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderHistory();
  });

  // Respaldo
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ format: 'stevenPay-v2', state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `respaldo-stevenpay-${getTodayString()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!Array.isArray(obj.state?.transactions)) throw Error();
      state = obj.state;
      saveData();
    } catch (err) {
      alert('Archivo JSON no válido.');
    }
  });

  loadData();
  renderApp();
})();
