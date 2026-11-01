// Progressive enhancements; every page works without JavaScript.

(() => {
  // Mobile navigation toggle.
  const toggle = document.querySelector('[data-menu-toggle]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const sidebar = toggle.closest('.sidebar');
      const open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Ask for confirmation before destructive or significant actions.
  document.addEventListener('submit', (event) => {
    const message = event.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  // Keep the occupancy dashboard current by polling its JSON endpoint.
  const live = document.querySelector('[data-live-stats]');
  if (live) {
    const url = live.getAttribute('data-live-stats');
    const setText = (key, value) => {
      document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => { el.textContent = value; });
    };
    const refresh = async () => {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!response.ok) return;
        const stats = await response.json();
        for (const [key, value] of Object.entries(stats)) {
          if (typeof value === 'number') setText(key, value);
        }
        setText('averageCompatibility', stats.averageCompatibility == null ? '—' : `${stats.averageCompatibility}%`);
        setText('occupancyRateLabel', `${stats.occupancyRate}%`);
        const meter = document.querySelector('[data-stat-meter="occupancyRate"]');
        if (meter) meter.style.width = `${stats.occupancyRate}%`;
        for (const hostel of stats.hostels) {
          const row = document.querySelector(`[data-hostel="${CSS.escape(hostel.hostel_name)}"]`);
          if (!row) continue;
          row.querySelector('[data-field="occupied"]').textContent = `${hostel.occupied_beds} / ${hostel.beds}`;
          row.querySelector('[data-field="free"]').textContent = hostel.freeBeds;
          row.querySelector('[data-field="full"]').textContent = `${hostel.full_rooms} / ${hostel.rooms}`;
          row.querySelector('[data-field="rate"]').textContent = `${hostel.occupancyRate}%`;
          row.querySelector('[data-field="meter"]').style.width = `${hostel.occupancyRate}%`;
        }
        const stamp = document.querySelector('[data-stat-updated]');
        if (stamp) stamp.textContent = new Date(stats.generatedAt).toLocaleTimeString();
      } catch {
        // Network hiccups are ignored; the next poll will try again.
      }
    };
    setInterval(refresh, 15000);
  }
})();
